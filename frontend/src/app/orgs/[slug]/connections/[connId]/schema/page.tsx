'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { connectionApi, orgApi } from '@/lib/api';

const TYPE_COLORS: Record<string, string> = {
  'varchar': 'text-sky-400',
  'text': 'text-sky-400',
  'character varying': 'text-sky-400',
  'int': 'text-amber-400',
  'integer': 'text-amber-400',
  'bigint': 'text-amber-400',
  'numeric': 'text-amber-400',
  'decimal': 'text-amber-400',
  'float': 'text-amber-400',
  'double': 'text-amber-400',
  'boolean': 'text-emerald-400',
  'bool': 'text-emerald-400',
  'timestamp': 'text-purple-400',
  'date': 'text-purple-400',
  'datetime': 'text-purple-400',
  'json': 'text-pink-400',
  'jsonb': 'text-pink-400',
};

function typeColor(dataType: string) {
  const lower = (dataType || '').toLowerCase();
  for (const [key, color] of Object.entries(TYPE_COLORS)) {
    if (lower.includes(key)) return color;
  }
  return 'text-zinc-400';
}

export default function SchemaExplorerPage() {
  const { slug, connId } = useParams<{ slug: string; connId: string }>();
  const [org, setOrg] = useState<any>(null);
  const [conn, setConn] = useState<any>(null);
  const [tables, setTables] = useState<any[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [columns, setColumns] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [colLoading, setColLoading] = useState(false);

  useEffect(() => { loadData(); }, [slug, connId]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (org) loadTables(search);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  async function loadData() {
    try {
      const { org: o } = await orgApi.get(slug);
      setOrg(o);
      const { connection: c } = await connectionApi.get(o.id, connId);
      setConn(c);
      await loadTables('', o.id);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function loadTables(q: string, orgIdOverride?: string) {
    try {
      const oid = orgIdOverride || org?.id;
      if (!oid) return;
      const qs = q ? `?q=${encodeURIComponent(q)}` : '';
      const r = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'}/orgs/${oid}/connections/${connId}/schema/tables${qs}`,
        { credentials: 'include' }
      );
      const { tables: t } = await r.json();
      setTables(t || []);
    } catch (e) { console.error(e); }
  }

  async function loadColumns(tableName: string) {
    if (!org) return;
    setColLoading(true);
    setSelectedTable(tableName);
    try {
      const r = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'}/orgs/${org.id}/connections/${connId}/schema/tables/${encodeURIComponent(tableName)}/columns`,
        { credentials: 'include' }
      );
      const { columns: cols } = await r.json();
      setColumns(cols || []);
    } catch (e) { console.error(e); }
    finally { setColLoading(false); }
  }

  if (loading) return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4 flex items-center gap-3 flex-shrink-0">
        <Link href={`/orgs/${slug}/connections`} className="text-zinc-500 hover:text-zinc-300">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>
        </Link>
        <div>
          <h1 className="text-base font-semibold">Schema Explorer</h1>
          <p className="text-xs text-zinc-500">{conn?.name} · {conn?.database_name}</p>
        </div>
        <div className="ml-auto flex items-center gap-4">
          <span className="text-xs text-zinc-500">{tables.length} tables</span>
          <Link href={`/orgs/${slug}/connections/${connId}/erd`} className="px-3 py-1.5 bg-violet-500/10 border border-violet-500/20 text-violet-400 hover:bg-violet-500/20 rounded-xl text-xs font-medium transition-colors">
            View ERD
          </Link>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar: Tables */}
        <div className="w-72 border-r border-white/10 flex flex-col flex-shrink-0">
          <div className="p-3 border-b border-white/5">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search tables and columns…"
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
            />
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            {tables.length === 0 ? (
              <div className="px-4 py-8 text-center text-zinc-600 text-sm">
                {search ? 'No tables match your search' : 'No schema synced. Go to connection and run Schema Sync.'}
              </div>
            ) : (
              tables.map((t: any) => (
                <button key={`${t.schema_name}.${t.table_name}`}
                  onClick={() => loadColumns(t.table_name)}
                  className={`w-full text-left px-4 py-2.5 flex items-center justify-between hover:bg-white/[0.04] transition-colors border-l-2 
                    ${selectedTable === t.table_name ? 'border-violet-500 bg-white/[0.05]' : 'border-transparent'}`}>
                  <div className="min-w-0">
                    <p className="text-sm text-zinc-300 truncate font-mono">{t.table_name}</p>
                    {t.schema_name && t.schema_name !== 'public' && (
                      <p className="text-xs text-zinc-600">{t.schema_name}</p>
                    )}
                  </div>
                  <div className="text-right ml-2 flex-shrink-0">
                    <p className="text-xs text-zinc-500">{t.column_count}c</p>
                    {t.row_count_estimate && (
                      <p className="text-xs text-zinc-600">{Number(t.row_count_estimate).toLocaleString()}r</p>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Main: Columns */}
        <div className="flex-1 overflow-y-auto p-6">
          {!selectedTable ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
              <div className="text-5xl">📋</div>
              <div>
                <h2 className="text-base font-medium text-zinc-300">Select a table</h2>
                <p className="text-sm text-zinc-600">Choose a table from the sidebar to see its columns</p>
              </div>
            </div>
          ) : (
            <div>
              <div className="mb-5">
                <h2 className="text-lg font-semibold font-mono">{selectedTable}</h2>
                <p className="text-sm text-zinc-400 mt-0.5">{columns.length} columns</p>
              </div>

              {colLoading ? (
                <div className="flex justify-center py-8">
                  <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <div className="border border-white/10 rounded-2xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-white/5">
                      <tr className="text-left">
                        <th className="px-4 py-2.5 text-xs text-zinc-400 font-medium">Column</th>
                        <th className="px-4 py-2.5 text-xs text-zinc-400 font-medium">Type</th>
                        <th className="px-4 py-2.5 text-xs text-zinc-400 font-medium">Nullable</th>
                        <th className="px-4 py-2.5 text-xs text-zinc-400 font-medium">Flags</th>
                        <th className="px-4 py-2.5 text-xs text-zinc-400 font-medium">Default</th>
                      </tr>
                    </thead>
                    <tbody>
                      {columns.map((col: any) => (
                        <tr key={col.column_name} className="border-t border-white/5 hover:bg-white/[0.02]">
                          <td className="px-4 py-2.5 font-mono text-zinc-200">
                            {col.column_name}
                          </td>
                          <td className={`px-4 py-2.5 font-mono text-xs ${typeColor(col.data_type)}`}>
                            {col.data_type}
                          </td>
                          <td className="px-4 py-2.5">
                            {col.is_nullable ? (
                              <span className="text-xs text-zinc-500">nullable</span>
                            ) : (
                              <span className="text-xs text-red-400/70">required</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex gap-1.5">
                              {col.is_primary_key && (
                                <span className="text-xs px-1.5 py-0.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded">PK</span>
                              )}
                              {col.is_foreign_key && (
                                <span className="text-xs px-1.5 py-0.5 bg-sky-500/10 border border-sky-500/20 text-sky-400 rounded" title={`→ ${col.fk_ref_table}.${col.fk_ref_column}`}>FK</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-zinc-600 font-mono">
                            {col.default_value || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
