'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { connectionApi, orgApi } from '@/lib/api';

const TYPE_COLORS: Record<string, string> = {
  'varchar': 'text-sky-400',
  'text': 'text-sky-400',
  'int': 'text-amber-400',
  'integer': 'text-amber-400',
  'bigint': 'text-amber-400',
  'numeric': 'text-amber-400',
  'decimal': 'text-amber-400',
  'float': 'text-amber-400',
  'double': 'text-amber-400',
  'boolean': 'text-success',
  'tinyint': 'text-success',
  'timestamp': 'text-pink-400',
  'date': 'text-pink-400',
  'datetime': 'text-pink-400',
  'json': 'text-accent',
};

function typeColor(dataType: string) {
  const lower = (dataType || '').toLowerCase();
  for (const [key, color] of Object.entries(TYPE_COLORS)) {
    if (lower.includes(key)) return color;
  }
  return 'text-muted-foreground';
}

export default function SchemaExplorerPage() {
  const { slug, connId } = useParams<{ slug: string; connId: string }>();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const router = useRouter();
  
  const [org, setOrg] = useState<any>(null);
  const [conn, setConn] = useState<any>(null);
  const [tables, setTables] = useState<any[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [columns, setColumns] = useState<any[]>([]);
  const [incomingRefs, setIncomingRefs] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [colLoading, setColLoading] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadData(); }, [slug, connId]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setTimeout(() => {
      if (org) loadTables(search);
    }, 300);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const data = await r.json();
      setColumns(data.columns || []);
      setIncomingRefs(data.incoming_references || []);
    } catch (e) { console.error(e); }
    finally { setColLoading(false); }
  }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const outgoingRefs = columns.filter(c => c.is_foreign_key);
  const pkCount = columns.filter(c => c.is_primary_key).length;
  const fkCount = outgoingRefs.length;

  const isES = conn?.connector_type === 'elasticsearch';
  const isBQ = conn?.connector_type === 'bigquery';
  
  const dbTerm = isES ? 'Cluster' : isBQ ? 'Dataset' : 'DB';
  const tableTerm = isES ? 'Index' : 'Table';
  const tableTermPlural = isES ? 'Indexes' : 'Tables';
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const colTerm = isES ? 'Field' : 'Column';
  const colTermPlural = isES ? 'Fields' : 'Columns';

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <header className="border-b border-border px-6 py-3 flex items-center justify-between flex-shrink-0 bg-card/60">
        <div className="flex items-center gap-4">
          <Link href={`/orgs/${slug}/connections`} className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-sm transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>
            Schema Explorer
          </Link>
          <div className="h-4 w-px bg-white/10" />
          <div className="flex items-center gap-2">
            <span className="text-xl">🗄️</span>
            <span className="font-semibold">{conn?.database_name || conn?.name}</span>
            <span className="text-xs text-muted-foreground/60 font-mono ml-2">ERD</span>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button 
            onClick={() => alert('Explain DB is coming soon!')}
            className="px-3 py-1.5 bg-muted/50 border border-border hover:bg-white/10 rounded-lg text-xs font-medium text-primary transition-colors flex items-center gap-2">
            ✨ Explain {dbTerm}
          </button>
          <Link href={`/orgs/${slug}/connections/${connId}/erd`} className="px-3 py-1.5 bg-primary hover:opacity-90 rounded-lg text-xs font-medium text-white transition-colors flex items-center gap-2">
            👁️ View ERD
          </Link>
          <button 
            onClick={() => alert('Copy ERD is coming soon!')}
            className="px-3 py-1.5 bg-muted/50 border border-border hover:bg-white/10 rounded-lg text-xs font-medium text-foreground transition-colors flex items-center gap-2">
            📋 Copy ERD
          </button>
          <span className="text-xs text-muted-foreground ml-4">{tables.length} {tableTermPlural.toLowerCase()}</span>
          <span className="text-xs text-muted-foreground">{tables.reduce((sum, t) => sum + Number(t.column_count || 0), 0)} {colTermPlural.toLowerCase()}</span>
          <span className="text-xs text-muted-foreground">{tables.reduce((sum, t) => sum + Number(t.fk_count || 0), 0)} relationships</span>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar: Tables */}
        <div className="w-64 border-r border-border flex flex-col flex-shrink-0 bg-card/60">
          <div className="p-3 border-b border-white/5">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={`Filter ${tableTermPlural.toLowerCase()}...`}
              className="w-full px-3 py-1.5 bg-muted/50 border border-border rounded-lg text-sm text-white placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50"
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {tables.length === 0 ? (
              <div className="px-4 py-8 text-center text-muted-foreground/60 text-sm">
                No {tableTermPlural.toLowerCase()} synced.
              </div>
            ) : (
              tables.map((t: any) => (
                <button key={`${t.schema_name}.${t.table_name}`}
                  onClick={() => loadColumns(t.table_name)}
                  className={`w-full text-left px-4 py-2 flex items-center justify-between hover:bg-muted/20 transition-colors
                    ${selectedTable === t.table_name ? 'bg-primary/10 border-l-2 border-primary text-white' : 'border-l-2 border-transparent text-muted-foreground'}`}>
                  <span className="text-sm truncate font-mono">{t.table_name}</span>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {Number(t.fk_count) > 0 && (
                      <span className="text-[10px] font-medium text-sky-400">{t.fk_count}FK</span>
                    )}
                    <span className="text-xs text-muted-foreground/60 font-mono w-6 text-right">{t.column_count}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Main: Columns */}
        <div className="flex-1 overflow-y-auto bg-background">
          {!selectedTable ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
              <div className="text-4xl text-muted-foreground">🗄️</div>
              <h2 className="text-lg font-medium text-muted-foreground">Select a {tableTerm.toLowerCase()} to view schema</h2>
            </div>
          ) : (
            <div className="p-8 max-w-6xl mx-auto">
              
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <div className="text-2xl text-primary">🗂️</div>
                  <h2 className="text-2xl font-bold font-mono tracking-tight">{selectedTable}</h2>
                </div>
                
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 bg-muted/50 border border-border rounded-lg px-3 py-1.5">
                    <span className="text-xs text-muted-foreground font-mono">{columns.length} {colTermPlural.toLowerCase()}</span>
                    {pkCount > 0 && <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded font-bold">1 PK</span>}
                    {fkCount > 0 && <span className="text-[10px] px-1.5 py-0.5 bg-sky-500/20 text-sky-400 rounded font-bold">{fkCount} FK</span>}
                  </div>
                  <button 
                    onClick={() => alert('Preview data is coming soon!')}
                    className="px-3 py-1.5 bg-muted/50 border border-border hover:bg-white/10 rounded-lg text-xs font-medium text-foreground transition-colors flex items-center gap-2">
                    Preview data
                  </button>
                  <Link href={`/orgs/${slug}/chats/new?connectionId=${connId}`} className="px-3 py-1.5 bg-primary hover:opacity-90 rounded-lg text-xs font-medium text-white transition-colors flex items-center gap-2">
                    Ask in Chat
                  </Link>
                </div>
              </div>

              {colLoading ? (
                <div className="flex justify-center py-12">
                  <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <>
                  <div className="mb-4 text-xs font-bold text-muted-foreground tracking-widest uppercase">{colTermPlural}</div>
                  <div className="border border-border rounded-xl bg-card/60 overflow-hidden mb-12 shadow-xl shadow-black/20">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-border bg-muted/20">
                          <th className="px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider w-1/3">Name</th>
                          <th className="px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider w-1/4">Type</th>
                          <th className="px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider w-1/6">Flags</th>
                          <th className="px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider w-1/4">Nullable</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.04]">
                        {columns.map((col: any) => (
                          <tr key={col.column_name} className="hover:bg-muted/20 transition-colors">
                            <td className="px-6 py-3.5 font-mono text-sm text-foreground">
                              {col.column_name}
                            </td>
                            <td className={`px-6 py-3.5 font-mono text-sm ${typeColor(col.data_type)}`}>
                              {col.data_type}
                            </td>
                            <td className="px-6 py-3.5">
                              <div className="flex gap-2">
                                {col.is_primary_key && (
                                  <div className="flex items-center gap-1.5 px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 text-amber-500 rounded text-[10px] font-bold">
                                    <span>🔑</span> PK
                                  </div>
                                )}
                                {col.is_foreign_key && (
                                  <div className="flex items-center gap-1.5 px-2 py-0.5 bg-sky-500/10 border border-sky-500/20 text-sky-400 rounded text-[10px] font-bold" 
                                       title={`→ ${col.fk_ref_table}.${col.fk_ref_column}`}>
                                    <span>🔗</span> FK
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-3.5">
                              {col.is_nullable ? (
                                <span className="text-sm font-mono text-muted-foreground">YES</span>
                              ) : (
                                <span className="text-sm font-mono text-foreground font-medium">NO</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {outgoingRefs.length > 0 && (
                    <div className="mb-8">
                      <div className="mb-3 text-xs font-bold text-muted-foreground tracking-widest uppercase">References (Outgoing)</div>
                      <div className="flex flex-wrap gap-3">
                        {outgoingRefs.map((ref: any, idx: number) => (
                          <div key={idx} className="flex items-center gap-2 px-3 py-2 bg-muted/50 border border-border rounded-lg text-xs font-mono">
                            <span className="text-muted-foreground">{selectedTable}.{ref.column_name}</span>
                            <span className="text-sky-400">→</span>
                            <button onClick={() => loadColumns(ref.fk_ref_table)} className="text-sky-400 hover:text-sky-300 transition-colors">
                              {ref.fk_ref_table}.{ref.fk_ref_column}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {incomingRefs.length > 0 && (
                    <div>
                      <div className="mb-3 text-xs font-bold text-muted-foreground tracking-widest uppercase">Referenced By (Incoming)</div>
                      <div className="flex flex-wrap gap-3">
                        {incomingRefs.map((ref: any, idx: number) => (
                          <div key={idx} className="flex items-center gap-2 px-3 py-2 bg-muted/50 border border-border rounded-lg text-xs font-mono">
                            <button onClick={() => loadColumns(ref.source_table)} className="text-sky-400 hover:text-sky-300 transition-colors">
                              {ref.source_table}.{ref.source_column}
                            </button>
                            <span className="text-sky-400">→</span>
                            <span className="text-muted-foreground">{selectedTable}.{ref.target_column}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
