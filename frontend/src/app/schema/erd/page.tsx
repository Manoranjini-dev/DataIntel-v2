'use client';

// ──────────────────────────────────────────────
// ERD Diagram — Interactive Entity-Relationship Diagram
// ──────────────────────────────────────────────

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type NodeTypes,
  MarkerType,
  Handle,
  Position,
  BackgroundVariant,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import { loadConnection } from '@/lib/storage';
import { getSchema } from '@/lib/api';
import type { SchemaTopology, SchemaTable } from '@/lib/types';
import {
  ArrowLeft,
  Database,
  KeyRound,
  Link2,
  Loader2,
  AlertCircle,
  Maximize2,
} from 'lucide-react';

// ── Layout constants ───────────────────────────

const NODE_WIDTH = 240;
const COL_ROW_H = 26;
const NODE_HEADER_H = 44;
const NODE_PADDING_H = 12;

function nodeHeight(table: SchemaTable): number {
  return NODE_HEADER_H + table.columns.length * COL_ROW_H + NODE_PADDING_H;
}

// ── Dagre auto-layout ──────────────────────────

function applyDagreLayout(
  nodes: Node[],
  edges: Edge[],
  direction: 'LR' | 'TB' = 'LR',
): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction, nodesep: 60, ranksep: 120, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((n) => {
    g.setNode(n.id, { width: NODE_WIDTH, height: n.data.height as number });
  });
  edges.forEach((e) => g.setEdge(e.source, e.target));

  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      ...n,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - (n.data.height as number) / 2,
      },
    };
  });
}

// ── Table Node component ───────────────────────

function TableNode({
  data,
  selected,
}: {
  data: {
    table: SchemaTable;
    height: number;
    isCentral: boolean;
  };
  selected: boolean;
}) {
  const { table, isCentral } = data;

  const headerColor = isCentral
    ? 'bg-indigo-700 border-indigo-500'
    : 'bg-zinc-800 border-zinc-600';

  const borderColor = selected
    ? 'border-indigo-400 shadow-[0_0_0_2px_rgba(217,122,30,0.5)]'
    : isCentral
      ? 'border-indigo-600/60'
      : 'border-zinc-700/70';

  return (
    <div
      className={`rounded-lg border bg-zinc-900 overflow-hidden text-xs font-mono transition-all ${borderColor}`}
      style={{ width: NODE_WIDTH, minHeight: data.height }}
    >
      {/* Target handle — top center */}
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !rounded-full !border-2 !border-zinc-500 !bg-zinc-800"
      />

      {/* Header */}
      <div className={`flex items-center gap-2 px-3 py-2.5 border-b border-zinc-700/50 ${headerColor}`}>
        <Database className="h-3.5 w-3.5 shrink-0 text-zinc-300" />
        <span className="font-semibold text-white text-[13px] truncate leading-none">
          {table.name}
        </span>
        <span className="ml-auto text-[10px] text-zinc-400 shrink-0">
          {table.columns.length} cols
        </span>
      </div>

      {/* Columns */}
      <div className="py-1.5">
        {table.columns.map((col) => (
          <div
            key={col.name}
            className={`flex items-center gap-1.5 px-3 py-0.5 hover:bg-zinc-800/50 ${
              col.isPrimaryKey
                ? 'bg-amber-900/10'
                : col.isForeignKey
                  ? 'bg-blue-900/10'
                  : ''
            }`}
            style={{ height: COL_ROW_H }}
          >
            {col.isPrimaryKey ? (
              <KeyRound className="h-3 w-3 shrink-0 text-amber-400" />
            ) : col.isForeignKey ? (
              <Link2 className="h-3 w-3 shrink-0 text-blue-400" />
            ) : (
              <span className="h-3 w-3 shrink-0" />
            )}
            <span
              className={`flex-1 truncate leading-none ${
                col.isPrimaryKey
                  ? 'text-amber-300 font-semibold'
                  : col.isForeignKey
                    ? 'text-blue-300'
                    : 'text-zinc-300'
              }`}
            >
              {col.name}
            </span>
            <span className="text-[10px] text-zinc-500 shrink-0 ml-1">{col.type.split('(')[0]}</span>
            {!col.nullable && (
              <span className="text-[9px] text-zinc-600 ml-0.5">NN</span>
            )}
          </div>
        ))}
      </div>

      {/* Source handle — right center */}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !rounded-full !border-2 !border-zinc-500 !bg-zinc-800"
      />
    </div>
  );
}

const nodeTypes: NodeTypes = { tableNode: TableNode };

// ── Build nodes + edges from schema topology ───

function buildGraph(topology: SchemaTopology): { nodes: Node[]; edges: Edge[] } {
  // Tag "central" tables (referenced by 3+ others)
  const referencedCount = new Map<string, number>();
  topology.tables.forEach((t) => {
    t.foreignKeys.forEach((fk) => {
      const prev = referencedCount.get(fk.referencedTable) ?? 0;
      referencedCount.set(fk.referencedTable, prev + 1);
    });
  });

  const rawNodes: Node[] = topology.tables.map((t) => ({
    id: t.name,
    type: 'tableNode',
    position: { x: 0, y: 0 },
    data: {
      table: t,
      height: nodeHeight(t),
      isCentral: (referencedCount.get(t.name) ?? 0) >= 2,
    },
  }));

  const edges: Edge[] = [];
  topology.tables.forEach((t) => {
    t.foreignKeys.forEach((fk, i) => {
      edges.push({
        id: `${t.name}.${fk.columnName}->${fk.referencedTable}.${fk.referencedColumn}-${i}`,
        source: t.name,
        target: fk.referencedTable,
        label: `${fk.columnName} → ${fk.referencedColumn}`,
        type: 'smoothstep',
        animated: false,
        style: { stroke: '#D97A1E', strokeWidth: 1.5 },
        labelStyle: { fill: '#a1a1aa', fontSize: 10, fontFamily: 'monospace' },
        labelBgStyle: { fill: '#18181b', fillOpacity: 0.9 },
        labelBgPadding: [4, 2] as [number, number],
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: '#D97A1E',
          width: 16,
          height: 16,
        },
        markerStart: {
          type: MarkerType.Arrow,
          color: '#D97A1E',
          width: 8,
          height: 8,
        },
      });
    });
  });

  const layoutNodes = applyDagreLayout(rawNodes, edges, 'LR');
  return { nodes: layoutNodes, edges };
}

// ── ERD Inner (needs ReactFlowProvider context) ─

function ERDInner({ topology }: { topology: SchemaTopology }) {
  const { fitView } = useReactFlow();

  const { nodes: initNodes, edges: initEdges } = useMemo(
    () => buildGraph(topology),
    [topology],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initEdges);

  // Re-fit on first mount
  useEffect(() => {
    setTimeout(() => fitView({ padding: 0.15, duration: 400 }), 100);
  }, [fitView]);

  const onConnect = useCallback(
    (params: Parameters<typeof addEdge>[0]) => setEdges((eds) => addEdge(params, eds)),
    [setEdges],
  );

  // Highlight connected edges when node selected
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const connectedIds = new Set<string>();
      initEdges.forEach((e) => {
        if (e.source === node.id || e.target === node.id) {
          connectedIds.add(e.id);
        }
      });
      setEdges((eds) =>
        eds.map((e) => ({
          ...e,
          style: {
            ...e.style,
            stroke: connectedIds.has(e.id) ? '#f59e0b' : '#D97A1E',
            strokeWidth: connectedIds.has(e.id) ? 2.5 : 1.5,
            opacity: connectedIds.size > 0 ? (connectedIds.has(e.id) ? 1 : 0.25) : 1,
          },
        })),
      );
    },
    [initEdges, setEdges],
  );

  const onPaneClick = useCallback(() => {
    setEdges((eds) =>
      eds.map((e) => ({
        ...e,
        style: { ...e.style, stroke: '#D97A1E', strokeWidth: 1.5, opacity: 1 },
      })),
    );
  }, [setEdges]);

  // Relayout LR vs TB
  const [direction, setDirection] = useState<'LR' | 'TB'>('LR');
  const relayout = (dir: 'LR' | 'TB') => {
    setDirection(dir);
    const laid = applyDagreLayout(nodes, edges, dir);
    setNodes(laid);
    setTimeout(() => fitView({ padding: 0.15, duration: 400 }), 50);
  };

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        className="bg-zinc-950"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="#3f3f46"
        />
        <Controls
          className="!bg-zinc-900 !border-zinc-700 [&>button]:!bg-zinc-800 [&>button]:!border-zinc-700 [&>button]:!text-zinc-300 [&>button:hover]:!bg-zinc-700"
        />
        <MiniMap
          className="!bg-zinc-900 !border-zinc-700 !rounded-lg overflow-hidden"
          nodeColor={(n) =>
            (n.data as { isCentral: boolean }).isCentral ? '#4f46e5' : '#27272a'
          }
          maskColor="rgba(0,0,0,0.6)"
        />

        {/* Layout switcher */}
        <div className="absolute top-3 right-3 z-10 flex gap-1.5">
          <button
            onClick={() => relayout('LR')}
            className={`rounded-md px-2.5 py-1.5 text-xs font-medium border transition-colors ${
              direction === 'LR'
                ? 'bg-indigo-600 border-indigo-500 text-white'
                : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            Left → Right
          </button>
          <button
            onClick={() => relayout('TB')}
            className={`rounded-md px-2.5 py-1.5 text-xs font-medium border transition-colors ${
              direction === 'TB'
                ? 'bg-indigo-600 border-indigo-500 text-white'
                : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            Top ↓ Bottom
          </button>
          <button
            onClick={() => fitView({ padding: 0.15, duration: 400 })}
            className="rounded-md px-2 py-1.5 border bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 transition-colors"
            title="Fit view"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Legend */}
        <div className="absolute bottom-14 left-3 z-10 rounded-lg bg-zinc-900/90 border border-zinc-700/50 p-3 text-[11px] space-y-1.5 backdrop-blur-sm">
          <p className="font-semibold text-zinc-400 uppercase tracking-widest text-[10px] mb-2">Legend</p>
          <div className="flex items-center gap-2 text-zinc-300">
            <KeyRound className="h-3 w-3 text-amber-400" />
            <span>Primary Key</span>
          </div>
          <div className="flex items-center gap-2 text-zinc-300">
            <Link2 className="h-3 w-3 text-blue-400" />
            <span>Foreign Key</span>
          </div>
          <div className="flex items-center gap-2 text-zinc-300">
            <span className="h-2.5 w-4 rounded-sm bg-indigo-600 inline-block" />
            <span>Central table (≥2 refs)</span>
          </div>
          <div className="flex items-center gap-2 text-zinc-300">
            <span className="h-0 w-4 border-t-2 border-indigo-400 inline-block" />
            <span>FK relationship</span>
          </div>
          <div className="flex items-center gap-2 text-zinc-300">
            <span className="h-0 w-4 border-t-2 border-amber-400 inline-block" />
            <span>Selected path</span>
          </div>
        </div>
      </ReactFlow>
    </div>
  );
}

// ── Page shell ─────────────────────────────────

export default function ERDPage() {
  const router = useRouter();
  const [topology, setTopology] = useState<SchemaTopology | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const conn = loadConnection();
    if (!conn?.sessionId) {
      router.push('/');
      return;
    }
    getSchema(conn.sessionId)
      .then((data) => {
        setTopology(data);
      })
      .catch((err: Error) => setError(err.message || 'Failed to load schema'))
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <div className="flex flex-col items-center gap-3 text-zinc-400">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
          <p className="text-sm">Building ERD…</p>
        </div>
      </div>
    );
  }

  if (error || !topology) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <div className="flex flex-col items-center gap-3 text-center">
          <AlertCircle className="h-8 w-8 text-red-400" />
          <p className="text-sm text-zinc-300">{error ?? 'No schema data'}</p>
          <button onClick={() => router.push('/schema')} className="text-xs text-indigo-400 hover:underline">
            ← Back to Schema
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* Top bar */}
      <header className="flex items-center gap-4 border-b border-zinc-800 bg-zinc-900/80 px-5 py-3 backdrop-blur-sm flex-shrink-0">
        <button
          onClick={() => router.push('/schema')}
          className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Schema Explorer
        </button>
        <div className="h-4 w-px bg-zinc-700" />
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-indigo-400" />
          <span className="font-semibold text-white">{topology.database}</span>
          <span className="text-xs text-zinc-500">ERD</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-zinc-500">
            {topology.stats.totalTables} tables · {topology.stats.totalRelationships} relationships
          </span>
          <span className="rounded-full bg-indigo-600/20 border border-indigo-600/40 px-2 py-0.5 text-[11px] text-indigo-300">
            Click a table to highlight its connections
          </span>
        </div>
      </header>

      {/* ERD canvas */}
      <div className="flex-1 overflow-hidden">
        <ReactFlowProvider>
          <ERDInner topology={topology} />
        </ReactFlowProvider>
      </div>
    </div>
  );
}
