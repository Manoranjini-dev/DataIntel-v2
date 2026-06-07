'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { connectionApi, orgApi, chatApi } from '@/lib/api';
import { Database, Table2, Eye, GitFork, Sparkles, X, Key, Link2, Clipboard, MessageSquare, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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

  const [org, setOrg] = useState<any>(null);
  const [conn, setConn] = useState<any>(null);
  const [tables, setTables] = useState<any[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [columns, setColumns] = useState<any[]>([]);
  const [incomingRefs, setIncomingRefs] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [colLoading, setColLoading] = useState(false);
  const [explainText, setExplainText] = useState('');
  const [explainLoading, setExplainLoading] = useState(false);
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [previewCols, setPreviewCols] = useState<string[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showExplain, setShowExplain] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

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

  async function handleExplainDB() {
    if (!org || !tables.length) return;
    setExplainLoading(true); setShowExplain(true); setExplainText('');
    try {
      const tableList = tables.slice(0, 20).map(t => `${t.table_name} (${t.column_count} cols, ${t.fk_count} FKs)`).join(', ');
      const { chats } = await chatApi.list(org.id, { connectionId: connId });
      let chatId: string;
      if (chats.length > 0) { chatId = chats[0].id; }
      else { const { chat } = await chatApi.create(org.id, { connectionId: connId }); chatId = chat.id; }
      const result = await chatApi.ask(org.id, chatId,
        `Explain this database schema in plain English. Tables: ${tableList}. Describe what this database is used for, its main entities, and key relationships. Be concise but informative.`, false);
      setExplainText((result as any)?.assistantMessage?.content || 'No explanation available.');
    } catch (e) { setExplainText('Failed to generate explanation.'); console.error(e); }
    finally { setExplainLoading(false); }
  }

  async function handlePreviewData(tableName: string) {
    if (!org) return;
    setPreviewLoading(true); setShowPreview(true); setPreviewRows([]); setPreviewCols([]);
    try {
      const { chats } = await chatApi.list(org.id, { connectionId: connId });
      let chatId: string;
      if (chats.length > 0) { chatId = chats[0].id; }
      else { const { chat } = await chatApi.create(org.id, { connectionId: connId }); chatId = chat.id; }
      const result = await chatApi.ask(org.id, chatId, `SELECT * FROM ${tableName} LIMIT 10`, true);
      const exec = (result as any)?.execution;
      if (exec?.rows) { setPreviewRows(exec.rows); setPreviewCols(exec.columns || []); }
    } catch (e) { console.error(e); }
    finally { setPreviewLoading(false); }
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

  async function handleCopyERD() {
    const lines = tables.map(t => `${t.table_name} (${t.column_count} columns, ${t.fk_count} FKs)`);
    await navigator.clipboard.writeText(lines.join('\n'));
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <header className="border-b border-border px-6 py-3 flex items-center justify-between flex-shrink-0 bg-card/60">
        <div className="flex items-center gap-3">
          <Database className="w-4 h-4 text-primary shrink-0" />
          <span className="font-semibold text-foreground">{conn?.database_name || conn?.name}</span>
          <div className="h-4 w-px bg-border mx-1" />
          <span className="text-xs text-muted-foreground">{tables.length} {tableTermPlural.toLowerCase()}</span>
          <span className="text-xs text-muted-foreground">{tables.reduce((sum, t) => sum + Number(t.column_count || 0), 0)} {colTermPlural.toLowerCase()}</span>
          <span className="text-xs text-muted-foreground">{tables.reduce((sum, t) => sum + Number(t.fk_count || 0), 0)} relationships</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExplainDB}
            disabled={explainLoading || !tables.length}
            className="px-3 py-1.5 bg-muted/50 border border-border hover:bg-muted/80 rounded-lg text-xs font-medium text-primary transition-colors flex items-center gap-1.5 disabled:opacity-50">
            {explainLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            Explain {dbTerm}
          </button>
          <Link href={`/orgs/${slug}/connections/${connId}/erd`} className="px-3 py-1.5 bg-primary hover:opacity-90 rounded-lg text-xs font-medium text-white transition-colors flex items-center gap-1.5">
            <GitFork className="w-3.5 h-3.5" />
            View ERD
          </Link>
          <button
            onClick={handleCopyERD}
            className="px-3 py-1.5 bg-muted/50 border border-border hover:bg-muted/80 rounded-lg text-xs font-medium text-foreground transition-colors flex items-center gap-1.5">
            <Clipboard className="w-3.5 h-3.5" />
            Copy ERD
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar: Tables */}
        <div className="w-64 border-r border-border flex flex-col flex-shrink-0 bg-card/60">
          <div className="p-3 border-b border-border">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={`Filter ${tableTermPlural.toLowerCase()}...`}
              className="w-full px-3 py-1.5 bg-muted/50 border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50"
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
                    ${selectedTable === t.table_name ? 'bg-primary/10 border-l-2 border-primary text-foreground' : 'border-l-2 border-transparent text-muted-foreground'}`}>
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
              <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center">
                <Database className="w-8 h-8 text-muted-foreground/50" />
              </div>
              <h2 className="text-lg font-medium text-muted-foreground">Select a {tableTerm.toLowerCase()} to view schema</h2>
              <p className="text-sm text-muted-foreground/60">Click any {tableTerm.toLowerCase()} in the sidebar to explore its columns and relationships</p>
            </div>
          ) : (
            <div className="p-8 max-w-6xl mx-auto">

              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Table2 className="w-[18px] h-[18px] text-primary" />
                  </div>
                  <h2 className="text-2xl font-bold font-mono tracking-tight">{selectedTable}</h2>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 bg-muted/50 border border-border rounded-lg px-3 py-1.5">
                    <span className="text-xs text-muted-foreground font-mono">{columns.length} {colTermPlural.toLowerCase()}</span>
                    {pkCount > 0 && <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded font-bold">1 PK</span>}
                    {fkCount > 0 && <span className="text-[10px] px-1.5 py-0.5 bg-sky-500/20 text-sky-400 rounded font-bold">{fkCount} FK</span>}
                  </div>
                  <button
                    onClick={() => handlePreviewData(selectedTable)}
                    disabled={previewLoading}
                    className="px-3 py-1.5 bg-muted/50 border border-border hover:bg-muted/80 rounded-lg text-xs font-medium text-foreground transition-colors flex items-center gap-1.5 disabled:opacity-50">
                    {previewLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                    Preview data
                  </button>
                  <Link href={`/orgs/${slug}/connections/${connId}/chat`} className="px-3 py-1.5 bg-primary hover:opacity-90 rounded-lg text-xs font-medium text-white transition-colors flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5" />
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
                  <div className="border border-border rounded-xl bg-card/60 overflow-hidden mb-12 shadow-sm">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-border bg-muted/20">
                          <th className="px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider w-1/3">Name</th>
                          <th className="px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider w-1/4">Type</th>
                          <th className="px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider w-1/6">Flags</th>
                          <th className="px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider w-1/4">Nullable</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
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
                                  <div className="flex items-center gap-1 px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 text-amber-500 rounded text-[10px] font-bold">
                                    <Key className="w-2.5 h-2.5" /> PK
                                  </div>
                                )}
                                {col.is_foreign_key && (
                                  <div className="flex items-center gap-1 px-2 py-0.5 bg-sky-500/10 border border-sky-500/20 text-sky-400 rounded text-[10px] font-bold"
                                       title={`→ ${col.fk_ref_table}.${col.fk_ref_column}`}>
                                    <Link2 className="w-2.5 h-2.5" /> FK
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

      {/* Explain DB Modal */}
      {showExplain && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                <span className="font-semibold text-foreground">Database Explanation</span>
              </div>
              <button onClick={() => setShowExplain(false)} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {explainLoading ? (
                <div className="flex flex-col items-center gap-3 py-8">
                  <Loader2 className="w-7 h-7 text-primary animate-spin" />
                  <span className="text-sm text-muted-foreground">Analyzing schema…</span>
                </div>
              ) : (
                <div className="prose prose-sm prose-invert max-w-none text-foreground">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{explainText}</ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Preview Data Modal */}
      {showPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-primary" />
                <span className="font-semibold text-foreground">Preview — {selectedTable}</span>
                {!previewLoading && previewRows.length > 0 && (
                  <span className="text-xs text-muted-foreground ml-2">{previewRows.length} rows</span>
                )}
              </div>
              <button onClick={() => setShowPreview(false)} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {previewLoading ? (
                <div className="flex flex-col items-center gap-3 py-8">
                  <Loader2 className="w-7 h-7 text-primary animate-spin" />
                  <span className="text-sm text-muted-foreground">Fetching data…</span>
                </div>
              ) : previewRows.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                  <Table2 className="w-8 h-8 opacity-40" />
                  <span className="text-sm">No rows returned</span>
                </div>
              ) : (
                <div className="overflow-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        {previewCols.map(col => (
                          <th key={col} className="px-4 py-2.5 font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap font-mono">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {previewRows.map((row, ri) => (
                        <tr key={ri} className="hover:bg-muted/20 transition-colors">
                          {previewCols.map(col => (
                            <td key={col} className="px-4 py-2.5 font-mono text-foreground/80 whitespace-nowrap max-w-[200px] truncate">
                              {row[col] === null ? <span className="text-muted-foreground/40 italic">null</span> : String(row[col])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
