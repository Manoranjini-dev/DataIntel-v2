'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

// ─── Brand colours ────────────────────────────────────────────────
const ORANGE      = 0xD97A1E;
const ORANGE_BRT  = 0xF5A623;
const GREY_MID    = 0x9CA3AF;
const GREY_DIM    = 0x6B7280;

// ─── Scene constants ──────────────────────────────────────────────
const NODE_COUNT      = 52;
const EDGE_THRESHOLD  = 1.75;
const MAX_EDGES       = 78;
const PARTICLE_COUNT  = 38;
const BG_DOT_COUNT    = 480;

// ─── Types ────────────────────────────────────────────────────────
interface NodeData {
  pos:        THREE.Vector3;
  isOrange:   boolean;
  size:       number;
  pulsePhase: number;
  pulseSpeed: number;
}
interface EdgeData { from: number; to: number; }
interface ParticleState {
  edgeIdx: number;
  t:       number;
  speed:   number;
  reverse: boolean;
}

// ─── Build graph (runs once per mount) ───────────────────────────
function buildGraph(): { nodes: NodeData[]; edges: EdgeData[]; linePositions: Float32Array } {
  const nodes: NodeData[] = [];

  for (let i = 0; i < NODE_COUNT; i++) {
    const phi   = Math.acos(1 - (2 * (i + 0.5)) / NODE_COUNT);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    const r     = 2.4 + Math.random() * 1.1;
    nodes.push({
      pos:        new THREE.Vector3(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi),
      ),
      isOrange:   Math.random() < 0.24,
      size:       0.026 + Math.random() * 0.042,
      pulsePhase: Math.random() * Math.PI * 2,
      pulseSpeed: 0.7 + Math.random() * 1.6,
    });
  }

  // Shuffle so orange nodes are evenly distributed
  for (let i = nodes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [nodes[i], nodes[j]] = [nodes[j], nodes[i]];
  }

  const edges: EdgeData[] = [];
  outer: for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[i].pos.distanceTo(nodes[j].pos) < EDGE_THRESHOLD) {
        edges.push({ from: i, to: j });
        if (edges.length >= MAX_EDGES) break outer;
      }
    }
  }

  const linePositions = new Float32Array(edges.length * 6);
  edges.forEach(({ from, to }, idx) => {
    linePositions.set(nodes[from].pos.toArray(), idx * 6);
    linePositions.set(nodes[to].pos.toArray(),   idx * 6 + 3);
  });

  return { nodes, edges, linePositions };
}

// ─── Component ────────────────────────────────────────────────────
export default function DataNetworkScene() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || typeof window === 'undefined') return;

    // ── Renderer ────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    // ── Scene / Camera ──────────────────────────────────────────
    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      48,
      mount.clientWidth / mount.clientHeight,
      0.1,
      100,
    );
    camera.position.set(0, 0, 9.5);

    // ── Lights ──────────────────────────────────────────────────
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
    dirLight.position.set(6, 6, 6);
    scene.add(dirLight);
    const orangeLight = new THREE.PointLight(ORANGE_BRT, 0.9);
    orangeLight.position.set(-4, 2, 4);
    scene.add(orangeLight);
    const greyLight = new THREE.PointLight(GREY_MID, 0.25);
    greyLight.position.set(4, -3, -4);
    scene.add(greyLight);

    // ── Background ambient dots ──────────────────────────────────
    const bgPositions = new Float32Array(BG_DOT_COUNT * 3);
    for (let i = 0; i < BG_DOT_COUNT; i++) {
      bgPositions[i * 3]     = (Math.random() - 0.5) * 18;
      bgPositions[i * 3 + 1] = (Math.random() - 0.5) * 18;
      bgPositions[i * 3 + 2] = (Math.random() - 0.5) * 12;
    }
    const bgGeo  = new THREE.BufferGeometry();
    bgGeo.setAttribute('position', new THREE.BufferAttribute(bgPositions, 3));
    const bgDots = new THREE.Points(
      bgGeo,
      new THREE.PointsMaterial({ size: 0.028, color: GREY_MID, transparent: true, opacity: 0.28 }),
    );
    scene.add(bgDots);

    // ── Build graph ──────────────────────────────────────────────
    const { nodes, edges, linePositions } = buildGraph();

    const group = new THREE.Group();
    scene.add(group);

    // Edges (one line-segments draw call)
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    group.add(
      new THREE.LineSegments(
        lineGeo,
        new THREE.LineBasicMaterial({ color: ORANGE, transparent: true, opacity: 0.16 }),
      ),
    );

    // Node meshes
    const nodeMeshes = nodes.map(node => {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(node.size, 10, 10),
        new THREE.MeshStandardMaterial({
          color:             node.isOrange ? ORANGE    : GREY_MID,
          emissive:          node.isOrange ? ORANGE_BRT : GREY_DIM,
          emissiveIntensity: node.isOrange ? 0.65      : 0.05,
          roughness: 0.35,
          metalness: 0.45,
        }),
      );
      mesh.position.copy(node.pos);
      group.add(mesh);
      return mesh;
    });

    // Particle state + meshes
    const particleStates: ParticleState[] = Array.from({ length: PARTICLE_COUNT }, () => ({
      edgeIdx: Math.floor(Math.random() * edges.length),
      t:       Math.random(),
      speed:   0.11 + Math.random() * 0.27,
      reverse: Math.random() > 0.5,
    }));

    const particleMat   = new THREE.MeshBasicMaterial({ color: ORANGE_BRT });
    const particleGeo   = new THREE.SphereGeometry(0.021, 6, 6);
    const particleMeshes = particleStates.map(() => {
      const m = new THREE.Mesh(particleGeo, particleMat);
      group.add(m);
      return m;
    });

    // ── Mouse tracking ───────────────────────────────────────────
    let mouseX = 0;
    let mouseY = 0;
    const onMouseMove = (e: MouseEvent) => {
      mouseX = (e.clientX / window.innerWidth  - 0.5) * 2;
      mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener('mousemove', onMouseMove, { passive: true });

    // ── Resize handling ──────────────────────────────────────────
    const onResize = () => {
      if (!mount) return;
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    // ── Animation loop (pure RAF — no R3F) ──────────────────────
    let animId: number;
    let lastElapsed = 0;
    const clock = new THREE.Clock();
    const _v    = new THREE.Vector3();

    const animate = () => {
      animId = requestAnimationFrame(animate);

      const elapsed = clock.getElapsedTime();
      const delta   = elapsed - lastElapsed;
      lastElapsed   = elapsed;

      // Group rotation + mouse parallax
      group.rotation.y = elapsed * 0.052 + mouseX * 0.28;
      group.rotation.x = -mouseY * 0.13;

      // Bg dot drift
      bgDots.rotation.y = elapsed * 0.012;
      bgDots.rotation.x = elapsed * 0.007;

      // Pulse orange nodes
      for (let i = 0; i < nodes.length; i++) {
        if (!nodes[i].isOrange) continue;
        const s = 1 + 0.22 * Math.sin(elapsed * nodes[i].pulseSpeed + nodes[i].pulsePhase);
        nodeMeshes[i].scale.setScalar(s);
      }

      // Move particles along edges
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const p    = particleStates[i];
        const edge = edges[p.edgeIdx];
        if (!edge) continue;

        p.t += p.speed * delta * (p.reverse ? -1 : 1);
        if (p.t > 1 || p.t < 0) {
          p.t       = p.reverse ? 1 : 0;
          p.edgeIdx = Math.floor(Math.random() * edges.length);
          p.reverse = Math.random() > 0.5;
        }

        _v.lerpVectors(nodes[edge.from].pos, nodes[edge.to].pos, p.t);
        particleMeshes[i].position.copy(_v);
      }

      renderer.render(scene, camera);
    };
    animate();

    // ── Cleanup ──────────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={mountRef}
      style={{ width: '100%', height: '100%' }}
      aria-label="Interactive data network visualization"
    />
  );
}
