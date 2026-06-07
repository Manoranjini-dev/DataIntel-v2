'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { connectionApi, orgApi } from '@/lib/api';
import dynamic from 'next/dynamic';

// ── Types ──────────────────────────────────────────────────────
interface ERDColumn {
  name: string;
  type: string;
  isPk: boolean;
  isFk: boolean;
  fkRefTable?: string;
  fkRefCol?: string;
}

interface ERDNode {
  id: string;
  label: string;
  rowCount: string | null;
  columns: ERDColumn[];
  x: number;
  y: number;
}

interface ERDEdge {
  id: string;
  source: string;
  target: string;
  sourceCol: string;
  targetCol: string;
}

// ── Pure SVG ERD (no React Flow dependency issues) ─────────────
function SVGDiagram({ nodes, edges }: { nodes: ERDNode[]; edges: ERDEdge[] }) {
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});

  // Init positions from nodes
  useEffect(() => {
    const pos: Record<string, { x: number; y: number }> = {};
    nodes.forEach(n => { pos[n.id] = { x: n.x, y: n.y }; });
    setPositions(pos);
  }, [nodes]);

  const NODE_WIDTH = 220;
  const ROW_HEIGHT = 24;
  const HEADER_HEIGHT = 36;

  function nodeHeight(node: ERDNode) {
    return HEADER_HEIGHT + node.columns.length * ROW_HEIGHT + 8;
  }

  function getColumnY(node: ERDNode, colName: string, side: 'left' | 'right') {
    const pos = positions[node.id] || { x: node.x, y: node.y };
    const colIndex = node.columns.findIndex(c => c.name === colName);
    const cy = pos.y + HEADER_HEIGHT + (colIndex >= 0 ? colIndex : 0) * ROW_HEIGHT + ROW_HEIGHT / 2;
    const cx = side === 'left' ? pos.x : pos.x + NODE_WIDTH;
    return { x: cx, y: cy };
  }

  // Pan handlers
  function onMouseDown(e: React.MouseEvent) {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).closest?.('svg') === false) return;
    setDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  }
  function onMouseMove(e: React.MouseEvent) {
    if (!dragging) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  }
  function onMouseUp() { setDragging(false); }
  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    setZoom(z => Math.min(2, Math.max(0.2, z - e.deltaY * 0.001)));
  }

  const COLORS = ['#8b5cf6', '#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#ef4444', '#10b981', '#3b82f6'];

  return (
    <div
      className="w-full h-full overflow-hidden bg-[#0f0f14] cursor-grab active:cursor-grabbing select-none"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onWheel={onWheel}
    >
      <svg width="100%" height="100%">
        {/* Grid background */}
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="0.5" />
          </pattern>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto">
            <path d="M0,0 L0,8 L8,4 z" fill="#8b5cf6" />
          </marker>
          <filter id="shadow">
            <feDropShadow dx="0" dy="4" stdDeviation="8" floodColor="#000000" floodOpacity="0.5" />
          </filter>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />

        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {/* Draw edges first (below nodes) */}
          {edges.map(edge => {
            const srcNode = nodes.find(n => n.id === edge.source);
            const tgtNode = nodes.find(n => n.id === edge.target);
            if (!srcNode || !tgtNode) return null;
            const src = getColumnY(srcNode, edge.sourceCol, 'right');
            const tgt = getColumnY(tgtNode, edge.targetCol, 'left');
            const cx = (src.x + tgt.x) / 2;
            const path = `M${src.x},${src.y} C${cx},${src.y} ${cx},${tgt.y} ${tgt.x},${tgt.y}`;
            return (
              <g key={edge.id}>
                <path d={path} fill="none" stroke="#8b5cf6" strokeWidth="1.5" strokeOpacity="0.5" markerEnd="url(#arrow)" />
              </g>
            );
          })}

          {/* Draw nodes */}
          {nodes.map((node, nodeIdx) => {
            const pos = positions[node.id] || { x: node.x, y: node.y };
            const h = nodeHeight(node);
            const color = COLORS[nodeIdx % COLORS.length];
            const isSelected = selectedNode === node.id;
            return (
              <g key={node.id} transform={`translate(${pos.x}, ${pos.y})`}
                onClick={() => setSelectedNode(node.id === selectedNode ? null : node.id)}>
                <filter id={`shadow-${node.id}`}>
                  <feDropShadow dx="0" dy={isSelected ? 8 : 4} stdDeviation={isSelected ? 12 : 8}
                    floodColor={color} floodOpacity={isSelected ? 0.4 : 0.2} />
                </filter>
                {/* Card background */}
                <rect
                  x="0" y="0" width={NODE_WIDTH} height={h}
                  rx="10" ry="10"
                  fill="#1a1a28"
                  stroke={isSelected ? color : 'rgba(255,255,255,0.12)'}
                  strokeWidth={isSelected ? 2 : 1}
                  filter={`url(#shadow-${node.id})`}
                />
                {/* Header */}
                <rect x="0" y="0" width={NODE_WIDTH} height={HEADER_HEIGHT} rx="10" ry="10" fill={`${color}22`} />
                <rect x="0" y={HEADER_HEIGHT - 10} width={NODE_WIDTH} height={10} fill={`${color}22`} />
                {/* Color strip */}
                <rect x="0" y="0" width="4" height={h} rx="2" ry="2" fill={color} />
                {/* Header text */}
                <text x="16" y={HEADER_HEIGHT / 2 + 5} fontSize="12" fontWeight="700" fill="white" fontFamily="monospace">
                  {node.label}
                </text>
                {node.rowCount && (
                  <text x={NODE_WIDTH - 8} y={HEADER_HEIGHT / 2 + 5} fontSize="9" fill="rgba(255,255,255,0.4)" textAnchor="end" fontFamily="sans-serif">
                    {node.rowCount} rows
                  </text>
                )}
                {/* Columns */}
                {node.columns.map((col, ci) => {
                  const cy = HEADER_HEIGHT + ci * ROW_HEIGHT;
                  const isFK = col.isFk;
                  const isPK = col.isPk;
                  return (
                    <g key={col.name}>
                      <rect x="0" y={cy} width={NODE_WIDTH} height={ROW_HEIGHT}
                        fill={ci % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent'} />
                      {/* PK/FK badge */}
                      {(isPK || isFK) && (
                        <rect x="8" y={cy + 6} width={isPK ? 16 : 14} height={12} rx="3"
                          fill={isPK ? 'rgba(245,158,11,0.2)' : 'rgba(99,102,241,0.2)'}
                          stroke={isPK ? '#f59e0b' : '#6366f1'} strokeWidth="0.5" />
                      )}
                      {isPK && <text x="11" y={cy + 15} fontSize="8" fill="#f59e0b" fontWeight="700">PK</text>}
                      {isFK && !isPK && <text x="11" y={cy + 15} fontSize="8" fill="#6366f1" fontWeight="700">FK</text>}
                      {/* Column name */}
                      <text x={(isPK || isFK) ? 30 : 12} y={cy + 15} fontSize="11" fill="rgba(255,255,255,0.8)" fontFamily="monospace">
                        {col.name.length > 18 ? col.name.slice(0, 16) + '…' : col.name}
                      </text>
                      {/* Data type */}
                      <text x={NODE_WIDTH - 8} y={cy + 15} fontSize="9" fill="rgba(255,255,255,0.3)" textAnchor="end" fontFamily="monospace">
                        {col.type.length > 10 ? col.type.slice(0, 8) + '…' : col.type}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Zoom controls */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-1">
        <button onClick={() => setZoom(z => Math.min(2, z + 0.2))}
          className="w-8 h-8 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg text-white text-sm font-bold transition-colors">+</button>
        <button onClick={() => { setPan({ x: 0, y: 0 }); setZoom(1); }}
          className="w-8 h-8 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg text-white text-xs font-bold transition-colors">⊙</button>
        <button onClick={() => setZoom(z => Math.max(0.2, z - 0.2))}
          className="w-8 h-8 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg text-white text-sm font-bold transition-colors">−</button>
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-black/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-zinc-400 space-y-1">
        <div className="flex items-center gap-2"><span className="w-4 h-2 bg-amber-400/30 border border-amber-400 rounded" />PK = Primary Key</div>
        <div className="flex items-center gap-2"><span className="w-4 h-2 bg-indigo-400/30 border border-indigo-400 rounded" />FK = Foreign Key</div>
        <div className="flex items-center gap-2"><span className="w-8 border-t border-violet-400 border-dashed" />Relationship</div>
        <div className="text-zinc-600 mt-1">Scroll to zoom · Drag to pan</div>
      </div>
    </div>
  );
}

// ── Main ERD Page ──────────────────────────────────────────────
export default function ERDPage() {
  const { slug, connId } = useParams<{ slug: string; connId: string }>();
  const [org, setOrg] = useState<Record<string, unknown> | null>(null);
  const [conn, setConn] = useState<Record<string, unknown> | null>(null);
  const [nodes, setNodes] = useState<ERDNode[]>([]);
  const [edges, setEdges] = useState<ERDEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tableCount, setTableCount] = useState(0);

  useEffect(() => { loadData(); }, [slug, connId]);

  async function loadData() {
    try {
      setLoading(true);
      setError(null);
      const { org: o } = await orgApi.get(slug);
      setOrg(o as Record<string, unknown>);
      const { connection: c } = await connectionApi.get(o.id, connId);
      setConn(c as Record<string, unknown>);

      const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
      const tablesRes = await fetch(`${API}/orgs/${o.id}/connections/${connId}/schema/tables`, { credentials: 'include' });
      if (!tablesRes.ok) throw new Error('Failed to fetch tables');
      const { tables } = await tablesRes.json();

      if (!tables || tables.length === 0) {
        setError('No tables found. Make sure to sync the schema first from the connection page.');
        setLoading(false);
        return;
      }

      setTableCount(tables.length);
      const tableList = tables.slice(0, 25);

      // Fetch columns for all tables in parallel
      const colResults = await Promise.allSettled(
        tableList.map(async (t: Record<string, unknown>) => {
          const r = await fetch(
            `${API}/orgs/${o.id}/connections/${connId}/schema/tables/${encodeURIComponent(String(t.table_name))}/columns`,
            { credentials: 'include' }
          );
          const { columns } = await r.json();
          return { table: String(t.table_name), rowCount: t.row_count_estimate, columns: columns || [] };
        })
      );

      const tableData: Record<string, { rowCount: unknown; columns: Record<string, unknown>[] }> = {};
      colResults.forEach(result => {
        if (result.status === 'fulfilled') {
          tableData[result.value.table] = { rowCount: result.value.rowCount, columns: result.value.columns };
        }
      });

      buildGraph(tableList, tableData);
    } catch (e) {
      console.error(e);
      setError(String(e instanceof Error ? e.message : 'Failed to load ERD'));
    } finally {
      setLoading(false);
    }
  }

  function buildGraph(
    tables: Record<string, unknown>[],
    data: Record<string, { rowCount: unknown; columns: Record<string, unknown>[] }>
  ) {
    const newNodes: ERDNode[] = [];
    const newEdges: ERDEdge[] = [];
    const tableSet = new Set(tables.map(t => String(t.table_name)));

    const COLS_PER_ROW = 4;
    const H_SPACING = 280;
    const V_SPACING = 350;
    const START_X = 60;
    const START_Y = 60;

    tables.forEach((t, i) => {
      const tName = String(t.table_name);
      const td = data[tName] || { rowCount: null, columns: [] };
      const row = Math.floor(i / COLS_PER_ROW);
      const col = i % COLS_PER_ROW;

      const cols: ERDColumn[] = td.columns.map((c) => ({
        name: String(c.column_name || ''),
        type: String(c.data_type || ''),
        isPk: Boolean(c.is_primary_key),
        isFk: Boolean(c.is_foreign_key),
        fkRefTable: c.fk_ref_table ? String(c.fk_ref_table) : undefined,
        fkRefCol: c.fk_ref_column ? String(c.fk_ref_column) : undefined,
      }));

      newNodes.push({
        id: tName,
        label: tName,
        rowCount: td.rowCount ? Number(td.rowCount).toLocaleString() : null,
        columns: cols,
        x: START_X + col * H_SPACING,
        y: START_Y + row * V_SPACING,
      });

      cols.forEach(c => {
        if (c.isFk && c.fkRefTable && tableSet.has(c.fkRefTable)) {
          newEdges.push({
            id: `e-${tName}-${c.name}-${c.fkRefTable}`,
            source: tName,
            target: c.fkRefTable,
            sourceCol: c.name,
            targetCol: c.fkRefCol || '',
          });
        }
      });
    });

    setNodes(newNodes);
    setEdges(newEdges);
  }

  return (
    <div className="h-screen bg-[#0a0a0f] text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4 flex items-center gap-3 flex-shrink-0 bg-[#0a0a0f] z-10">
        <Link href={`/orgs/${slug}/connections/${connId}/schema`} className="text-zinc-500 hover:text-zinc-300 transition-colors">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
        </Link>
        <div className="flex-1">
          <h1 className="text-base font-semibold">Entity Relationship Diagram</h1>
          <p className="text-xs text-zinc-500">{conn ? `${conn.name} · ${conn.database_name}` : 'Loading…'}</p>
        </div>
        {!loading && nodes.length > 0 && (
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <span>{nodes.length} tables</span>
            <span>{edges.length} relationships</span>
            {tableCount > 25 && <span className="text-amber-400">Showing 25 of {tableCount}</span>}
          </div>
        )}
      </header>

      {/* ERD Canvas — must have explicit height */}
      <div className="flex-1 relative" style={{ minHeight: 0 }}>
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0f0f14]">
            <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-zinc-500 text-sm">Loading schema…</p>
          </div>
        )}
        {!loading && error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#0f0f14]">
            <div className="text-5xl">⚠️</div>
            <div className="text-center max-w-md">
              <h2 className="text-base font-medium text-zinc-300 mb-2">Could not load ERD</h2>
              <p className="text-sm text-zinc-500 mb-4">{error}</p>
              <Link href={`/orgs/${slug}/connections/${connId}`}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-xl text-sm font-medium transition-colors">
                Go to Connection → Sync Schema
              </Link>
            </div>
          </div>
        )}
        {!loading && !error && nodes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#0f0f14]">
            <div className="text-5xl">🕸️</div>
            <div className="text-center">
              <h2 className="text-lg font-medium text-zinc-300 mb-1">No tables found</h2>
              <p className="text-sm text-zinc-500">Sync the schema from the connection page first.</p>
            </div>
          </div>
        )}
        {!loading && !error && nodes.length > 0 && (
          <SVGDiagram nodes={nodes} edges={edges} />
        )}
      </div>
    </div>
  );
}
