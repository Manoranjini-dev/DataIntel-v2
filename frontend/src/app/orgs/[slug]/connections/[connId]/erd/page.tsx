'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { orgApi } from '@/lib/api';
import dagre from 'dagre';
import {
  ReactFlow,
  Controls,
  Background,
  applyNodeChanges,
  applyEdgeChanges,
  Handle,
  Position,
  NodeProps,
  BackgroundVariant,
  NodeChange,
  EdgeChange,
  Node,
  Edge
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// ── Custom Node ────────────────────────────────────────────────
function TableNode({ data }: NodeProps) {
  const { label, columns } = data as { label: string; columns: any[] };
  
  return (
    <div className="bg-card rounded-xl border border-border shadow-[0_8px_32px_rgba(0,0,0,0.4)] overflow-hidden min-w-[220px]">
      <div className="bg-primary/20 px-4 py-2.5 border-b border-primary/20">
        <h3 className="text-foreground font-mono font-bold text-sm tracking-tight">{label}</h3>
      </div>
      <div className="py-1.5 relative">
        {columns.map((col: any) => (
          <div key={col.name} className="relative px-4 py-1.5 flex items-center justify-between text-xs hover:bg-muted/20 group">
            {/* Target Handle for incoming FKs */}
            <Handle type="target" position={Position.Left} id={col.name} className="w-2 h-2 !bg-primary border-none opacity-0 group-hover:opacity-100 transition-opacity !-left-1" />
            
            <div className="flex items-center gap-2">
              {col.isPk && <span className="text-[9px] font-bold text-amber-500 bg-amber-500/10 px-1 py-0.5 rounded border border-amber-500/20">PK</span>}
              {col.isFk && !col.isPk && <span className="text-[9px] font-bold text-sky-400 bg-sky-500/10 px-1 py-0.5 rounded border border-sky-500/20">FK</span>}
              <span className="font-mono text-foreground">{col.name}</span>
            </div>
            <span className="font-mono text-muted-foreground text-[10px] ml-4">{col.type}</span>
            
            {/* Source Handle for outgoing FKs */}
            <Handle type="source" position={Position.Right} id={col.name} className="w-2 h-2 !bg-sky-400 border-none opacity-0 group-hover:opacity-100 transition-opacity !-right-1" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Layout Algorithm ───────────────────────────────────────────
const getLayoutedElements = (nodes: Node[], edges: Edge[], direction = 'LR') => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  
  const isHorizontal = direction === 'LR';
  dagreGraph.setGraph({ rankdir: direction, nodesep: 60, ranksep: 250 });

  nodes.forEach((node) => {
    // Estimate height: header 44 + rows * 28 + padding 12
    const height = 44 + ((node.data.columns as any[])?.length || 0) * 28 + 12;
    dagreGraph.setNode(node.id, { width: 220, height });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  nodes.forEach((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    node.targetPosition = isHorizontal ? Position.Left : Position.Top;
    node.sourcePosition = isHorizontal ? Position.Right : Position.Bottom;

    // Shift the dagre node position (anchor=center) to React Flow (anchor=top-left)
    node.position = {
      x: nodeWithPosition.x - 220 / 2,
      y: nodeWithPosition.y - nodeWithPosition.height / 2,
    };

    return node;
  });

  return { nodes, edges };
};

export default function ERDPage() {
  const { slug, connId } = useParams<{ slug: string; connId: string }>();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const nodeTypes = useMemo(() => ({ tableNode: TableNode }), []);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadData(); }, [slug, connId]);

  async function loadData() {
    try {
      setLoading(true);
      setError(null);
      const { org: o } = await orgApi.get(slug);
      
      const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
      const tablesRes = await fetch(`${API}/orgs/${o.id}/connections/${connId}/schema/tables`, { credentials: 'include' });
      if (!tablesRes.ok) throw new Error('Failed to fetch tables');
      const { tables } = await tablesRes.json();

      if (!tables || tables.length === 0) {
        setError('No tables found. Make sure to sync the schema first from the connection page.');
        setLoading(false);
        return;
      }

      // Limit to 50 tables for performance
      const tableList = tables.slice(0, 50); 
      const colResults = await Promise.allSettled(
        tableList.map(async (t: any) => {
          const r = await fetch(`${API}/orgs/${o.id}/connections/${connId}/schema/tables/${encodeURIComponent(String(t.table_name))}/columns`, { credentials: 'include' });
          const { columns } = await r.json();
          return { table: String(t.table_name), columns: columns || [] };
        })
      );

      const tableData: Record<string, any[]> = {};
      colResults.forEach(result => {
        if (result.status === 'fulfilled') {
          tableData[result.value.table] = result.value.columns;
        }
      });

      buildGraph(tableList, tableData);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function buildGraph(tables: any[], data: Record<string, any[]>) {
    const initialNodes: Node[] = [];
    const initialEdges: Edge[] = [];

    tables.forEach((t) => {
      const tName = String(t.table_name);
      const cols = data[tName] || [];
      
      initialNodes.push({
        id: tName,
        type: 'tableNode',
        position: { x: 0, y: 0 },
        data: {
          label: tName,
          columns: cols.map((c: any) => ({
            name: c.column_name,
            type: c.data_type,
            isPk: c.is_primary_key,
            isFk: c.is_foreign_key,
            fkRefTable: c.fk_ref_table,
            fkRefCol: c.fk_ref_column
          }))
        }
      });

      cols.forEach((c: any) => {
        if (c.is_foreign_key && c.fk_ref_table && data[c.fk_ref_table]) {
          initialEdges.push({
            id: `e-${tName}.${c.column_name}-${c.fk_ref_table}.${c.fk_ref_column}`,
            source: tName,
            sourceHandle: c.column_name,
            target: c.fk_ref_table,
            targetHandle: c.fk_ref_column,
            type: 'smoothstep',
            animated: true,
            style: { stroke: '#8b5cf6', strokeWidth: 1.5, opacity: 0.6 },
          });
        }
      });
    });

    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(initialNodes, initialEdges, 'LR');
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
  }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (error) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="bg-muted/50 border border-border rounded-2xl p-8 max-w-md text-center shadow-2xl shadow-black/50">
        <div className="text-4xl mb-4">⚠️</div>
        <p className="text-foreground mb-6">{error}</p>
        <Link href={`/orgs/${slug}/connections/${connId}`} className="px-4 py-2 bg-primary hover:opacity-90 rounded-lg text-sm font-medium transition-colors">
          Go back to Connection
        </Link>
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative overflow-hidden">
      <header className="absolute top-0 left-0 right-0 z-10 px-6 py-4 flex items-center justify-between pointer-events-none">
        <Link href={`/orgs/${slug}/connections/${connId}/schema`} className="pointer-events-auto flex items-center gap-2 px-4 py-2 bg-card/90 border border-border rounded-xl text-sm font-medium hover:bg-muted backdrop-blur-md transition-all text-foreground shadow-xl">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>
          Back to Schema
        </Link>
        <div className="pointer-events-auto flex items-center gap-2 bg-black/60 border border-border rounded-xl px-4 py-2 backdrop-blur-md text-xs text-muted-foreground font-medium shadow-xl shadow-black/20">
          <span className="text-primary font-bold">Drag</span> to pan · <span className="text-primary font-bold">Scroll</span> to zoom · <span className="text-primary font-bold">Drag tables</span> to move
        </div>
      </header>
      
      <div className="flex-1 w-full h-full">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.05}
          maxZoom={1.5}
          className="bg-background"
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(255,255,255,0.06)" />
          <Controls className="!bg-black/80 !border-border !fill-white !rounded-xl overflow-hidden shadow-xl" showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
