'use client';

// ──────────────────────────────────────────────
// Schema Topology Explorer
// ──────────────────────────────────────────────

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { getSchema, executeQuery, explainSchema } from '@/lib/api';
import { loadConnection } from '@/lib/storage';
import type { SchemaTopology, SchemaTable, QueryExecutionResult, ConnectorType } from '@/lib/types';
import { getConnectorFamily } from '@/lib/types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowLeft,
  Database,
  Search,
  Table2,
  KeyRound,
  Link2,
  AlertCircle,
  Loader2,
  ChevronRight,
  Eye,
  MessageSquarePlus,
  GitFork,
  Check,
  Network,
  Sparkles,
  X,
} from 'lucide-react';

const SCHEMA_CACHE_KEY = 'sqli_schema_topology';

// ── Badge helpers ──────────────────────────────

function Badge({
  children,
  variant = 'default',
}: {
  children: React.ReactNode;
  variant?: 'default' | 'pk' | 'fk' | 'null' | 'stat';
}) {
  const base = 'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold';
  const styles: Record<string, string> = {
    default: 'bg-zinc-800 text-zinc-300',
    pk: 'bg-amber-900/60 text-amber-300 border border-amber-700/40',
    fk: 'bg-blue-900/60 text-blue-300 border border-blue-700/40',
    null: 'bg-zinc-800 text-zinc-500',
    stat: 'bg-zinc-700/60 text-zinc-300 border border-zinc-600/40',
  };
  return <span className={`${base} ${styles[variant]}`}>{children}</span>;
}

// ── FK card ────────────────────────────────────

function FKCard({
  label,
  from,
  to,
}: {
  label: string;
  from: string;
  to: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-zinc-800/60 border border-zinc-700/50 px-3 py-2">
      <span className="text-xs text-zinc-400">{label}</span>
      <code className="text-xs text-blue-300">{from}</code>
      <ChevronRight className="h-3 w-3 text-zinc-600" />
      <code className="text-xs text-emerald-300">{to}</code>
    </div>
  );
}

// ── TableDetail ────────────────────────────────

function TableDetail({
  table,
  preview,
  previewLoading,
  onPreview,
  onAsk,
}: {
  table: SchemaTable;
  preview: QueryExecutionResult | null;
  previewLoading: boolean;
  onPreview: () => void;
  onAsk: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Table2 className="h-5 w-5 text-indigo-400" />
        <h2 className="text-xl font-semibold text-white">{table.name}</h2>
        <div className="flex gap-2 ml-auto flex-wrap">
          <Badge variant="stat">{table.columns.length} cols</Badge>
          {table.primaryKeys.length > 0 && (
            <Badge variant="pk">
              <KeyRound className="h-3 w-3" />
              {table.primaryKeys.length} PK
            </Badge>
          )}
          {table.foreignKeys.length > 0 && (
            <Badge variant="fk">
              <Link2 className="h-3 w-3" />
              {table.foreignKeys.length} FK
            </Badge>
          )}
          <button
            onClick={onPreview}
            disabled={previewLoading}
            className="inline-flex items-center gap-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/50 px-2.5 py-1 text-xs font-medium text-zinc-300 transition-colors disabled:opacity-50"
          >
            {previewLoading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Eye className="h-3 w-3" />
            )}
            Preview data
          </button>
          <button
            onClick={onAsk}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-600/40 px-2.5 py-1 text-xs font-medium text-indigo-300 transition-colors"
          >
            <MessageSquarePlus className="h-3 w-3" />
            Ask in Chat
          </button>
        </div>
      </div>

      {/* Columns */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3">
          Columns
        </h3>
        <div className="overflow-x-auto rounded-lg border border-zinc-700/50">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-700/50 bg-zinc-800/80">
                <th className="px-4 py-2 text-left text-xs font-semibold text-zinc-400">Name</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-zinc-400">Type</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-zinc-400">Flags</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-zinc-400">Nullable</th>
              </tr>
            </thead>
            <tbody>
              {table.columns.map((col, i) => (
                <tr
                  key={col.name}
                  className={`border-b border-zinc-800 transition-colors hover:bg-zinc-800/40 ${
                    i % 2 === 0 ? 'bg-zinc-900' : 'bg-zinc-900/50'
                  }`}
                >
                  <td className="px-4 py-2.5 font-mono text-zinc-200 text-xs">{col.name}</td>
                  <td className="px-4 py-2.5">
                    <code className="text-xs text-purple-300">{col.type}</code>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1.5">
                      {col.isPrimaryKey && (
                        <Badge variant="pk">
                          <KeyRound className="h-2.5 w-2.5" />
                          PK
                        </Badge>
                      )}
                      {col.isForeignKey && (
                        <Badge variant="fk">
                          <Link2 className="h-2.5 w-2.5" />
                          FK
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant={col.nullable ? 'null' : 'default'}>
                      {col.nullable ? 'YES' : 'NO'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Foreign keys (outgoing) */}
      {table.foreignKeys.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3">
            References (outgoing)
          </h3>
          <div className="flex flex-wrap gap-2">
            {table.foreignKeys.map((fk) => (
              <FKCard
                key={`${fk.columnName}->${fk.referencedTable}.${fk.referencedColumn}`}
                label={`${table.name}.${fk.columnName}`}
                from={`${table.name}.${fk.columnName}`}
                to={`${fk.referencedTable}.${fk.referencedColumn}`}
              />
            ))}
          </div>
        </section>
      )}

      {/* Referenced by (incoming) */}
      {table.referencedBy.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3">
            Referenced by (incoming)
          </h3>
          <div className="flex flex-wrap gap-2">
            {table.referencedBy.map((ref) => (
              <FKCard
                key={`${ref.fromTable}.${ref.fromColumn}->${ref.toColumn}`}
                label={`${ref.fromTable}.${ref.fromColumn}`}
                from={`${ref.fromTable}.${ref.fromColumn}`}
                to={`${table.name}.${ref.toColumn}`}
              />
            ))}
          </div>
        </section>
      )}

      {/* Data preview */}
      {preview && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3">
            Data preview
            <span className="ml-2 normal-case font-normal text-zinc-600">
              — first {preview.rows.length} rows
            </span>
          </h3>
          <div className="overflow-x-auto rounded-lg border border-zinc-700/50">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-700/50 bg-zinc-800/80">
                  {preview.columns.map((c) => (
                    <th key={c} className="px-3 py-2 text-left font-semibold text-zinc-400 whitespace-nowrap">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, i) => (
                  <tr key={i} className="border-b border-zinc-800 hover:bg-zinc-800/40">
                    {preview.columns.map((c) => {
                      const val = row[c];
                      return (
                        <td key={c} className="px-3 py-2 whitespace-nowrap">
                          {val === null || val === undefined ? (
                            <span className="text-zinc-600 italic">NULL</span>
                          ) : (
                            <span className="text-zinc-300">{String(val)}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────

export default function SchemaPage() {
  const router = useRouter();
  const [topology, setTopology] = useState<SchemaTopology | null>(null);
  const [selectedTable, setSelectedTable] = useState<SchemaTable | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [connectorType, setConnectorType] = useState<ConnectorType>('mysql');
  const [preview, setPreview] = useState<QueryExecutionResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [erdCopied, setErdCopied] = useState(false);
  const [explainText, setExplainText] = useState<string | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const [showExplain, setShowExplain] = useState(false);

  const connectorFamily = getConnectorFamily(connectorType);
  const isES = connectorFamily === 'elasticsearch';
  const entityLabelPlural = isES ? 'indices' : 'tables';

  const handleExplainDB = async () => {
    if (!topology) return;
    setShowExplain(true);
    setExplainLoading(true);
    setExplainText(null);
    try {
      // Build a concise schema summary from the already-loaded topology
      const lines: string[] = [];
      topology.tables.forEach((t) => {
        const pks = t.primaryKeys.join(', ');
        const fks = t.foreignKeys
          .map((fk) => `${fk.columnName} → ${fk.referencedTable}.${fk.referencedColumn}`)
          .join(', ');
        const cols = t.columns.map((c) => `${c.name} (${c.type}${c.isPrimaryKey ? ', PK' : ''}${c.isForeignKey ? ', FK' : ''})`).join(', ');
        lines.push(`${isES ? 'Index' : 'Table'}: ${t.name}`);
        lines.push(`  ${isES ? 'Mappings' : 'Columns'}: ${cols}`);
        if (pks) lines.push(`  Primary keys: ${pks}`);
        if (fks) lines.push(`  Foreign keys: ${fks}`);
      });
      const summary = lines.join('\n');
      const result = await explainSchema(summary, topology.database, connectorFamily);
      setExplainText(result.explanation);
    } catch {
      setExplainText('Unable to fetch AI explanation. Please try again.');
    } finally {
      setExplainLoading(false);
    }
  };

  const handleCopyERD = async () => {
    if (!topology) return;
    const lines = ['erDiagram'];
    topology.tables.forEach((t) => {
      t.foreignKeys.forEach((fk) => {
        const label = fk.columnName.replace(/[^a-zA-Z0-9_]/g, '_');
        lines.push(
          `  ${t.name.toUpperCase()} }o--|| ${fk.referencedTable.toUpperCase()} : "${label}"`,
        );
      });
    });
    const mermaid = lines.join('\n');
    await navigator.clipboard.writeText(mermaid);
    setErdCopied(true);
    setTimeout(() => setErdCopied(false), 2500);
  };

  // Load session from the app's storage key (sqli_connection)
  useEffect(() => {
    const conn = loadConnection();
    if (!conn?.sessionId) {
      router.push('/');
      return;
    }
    setSessionId(conn.sessionId);
    if (conn.connectorType) setConnectorType(conn.connectorType as ConnectorType);
  }, [router]);

  // Fetch schema once sessionId is set
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    let hasCached = false;
    if (typeof window !== 'undefined') {
      try {
        const raw = sessionStorage.getItem(`${SCHEMA_CACHE_KEY}:${sessionId}`);
        if (raw) {
          const cached = JSON.parse(raw) as SchemaTopology;
          setTopology(cached);
          if (cached.tables.length > 0) setSelectedTable(cached.tables[0]);
          hasCached = true;
        }
      } catch {
        // ignore cache parsing errors
      }
    }

    setLoading(!hasCached);
    setError(null);
    getSchema(sessionId)
      .then((data) => {
        if (cancelled) return;
        setTopology(data);
        if (data.tables.length > 0) setSelectedTable(data.tables[0]);
        if (typeof window !== 'undefined') {
          try {
            sessionStorage.setItem(`${SCHEMA_CACHE_KEY}:${sessionId}`, JSON.stringify(data));
          } catch {
            // ignore storage quota errors
          }
        }
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message || 'Failed to load schema');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const filteredTables = useMemo(() => {
    if (!topology) return [];
    const q = search.toLowerCase();
    return topology.tables.filter((t) => t.name.toLowerCase().includes(q));
  }, [topology, search]);

  const handleSelectTable = (t: SchemaTable) => {
    setSelectedTable(t);
    setPreview(null);
  };

  const handlePreview = async () => {
    if (!selectedTable || !sessionId) return;
    setPreviewLoading(true);
    setPreview(null);
    try {
      const query = isES
        ? JSON.stringify({ _index: selectedTable.name, query: { match_all: {} }, size: 10 })
        : `SELECT * FROM \`${selectedTable.name}\` LIMIT 10`;
      const result = await executeQuery(sessionId, query, undefined, true);
      setPreview(result);
    } catch {
      // silently ignore — user sees nothing loaded
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleAsk = () => {
    if (!selectedTable) return;
    sessionStorage.setItem(
      'sqli_prefill',
      isES
        ? `Show me interesting insights about the ${selectedTable.name} index`
        : `Show me interesting insights about the ${selectedTable.name} table`,
    );
    router.push('/chat');
  };

  // ── Loading state ──────────────────────────

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <div className="flex flex-col items-center gap-3 text-zinc-400">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
          <p className="text-sm">Loading schema topology…</p>
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <div className="flex flex-col items-center gap-3 text-center max-w-md">
          <AlertCircle className="h-8 w-8 text-red-400" />
          <p className="text-sm text-zinc-300">{error}</p>
          <button
            onClick={() => router.push('/chat')}
            className="mt-2 text-xs text-indigo-400 hover:underline"
          >
            ← Back to Chat
          </button>
        </div>
      </div>
    );
  }

  if (!topology) return null;

  // ── Main layout ────────────────────────────

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* Top bar */}
      <header className="flex items-center gap-4 border-b border-zinc-800 bg-zinc-900/80 px-5 py-3 backdrop-blur-sm">
        <button
          onClick={() => router.push('/chat')}
          className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Chat
        </button>
        <div className="h-4 w-px bg-zinc-700" />
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-indigo-400" />
          <span className="font-semibold text-white">{topology.database}</span>
          <code className="text-[11px] text-zinc-500 font-mono">{topology.hash.slice(0, 8)}</code>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleExplainDB}
            className="inline-flex items-center gap-1.5 rounded-md border border-violet-600/40 bg-violet-600/10 hover:bg-primary/20 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {isES ? 'Explain Cluster' : 'Explain DB'}
          </button>
          {!isES && (
            <>
              <button
                onClick={() => router.push('/schema/erd')}
                className="inline-flex items-center gap-1.5 rounded-md border border-indigo-600/40 bg-indigo-600/10 hover:bg-indigo-600/20 px-2.5 py-1.5 text-xs font-medium text-indigo-300 transition-colors"
              >
                <Network className="h-3.5 w-3.5" />
                View ERD
              </button>
              <button
                onClick={handleCopyERD}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700/50 bg-zinc-800/60 hover:bg-zinc-700/60 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors"
              >
                {erdCopied ? (
                  <><Check className="h-3.5 w-3.5 text-emerald-400" /> Copied!</>
                ) : (
                  <><GitFork className="h-3.5 w-3.5" /> Copy ERD</>
                )}
              </button>
            </>
          )}
          <Badge variant="stat">{topology.stats.totalTables} {entityLabelPlural}</Badge>
          <Badge variant="stat">{topology.stats.totalColumns} {isES ? 'fields' : 'columns'}</Badge>
          {!isES && <Badge variant="stat">{topology.stats.totalRelationships} relationships</Badge>}
        </div>
      </header>

      {/* Body: sidebar + detail */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar: table list */}
        <aside className="flex w-60 flex-shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/40">
          {/* Search */}
          <div className="p-3 border-b border-zinc-800">
            <div className="flex items-center gap-2 rounded-md bg-zinc-800/60 border border-zinc-700/50 px-2.5 py-1.5">
              <Search className="h-3.5 w-3.5 text-zinc-500" />
              <input
                type="text"
                placeholder="Filter tables…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 outline-none"
              />
            </div>
          </div>
          {/* List */}
          <div className="flex-1 overflow-y-auto py-1">
            {filteredTables.map((t) => (
              <button
                key={t.name}
                onClick={() => handleSelectTable(t)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-800/60 ${
                  selectedTable?.name === t.name
                    ? 'bg-indigo-900/30 text-white border-l-2 border-indigo-500'
                    : 'text-zinc-400 border-l-2 border-transparent'
                }`}
              >
                <span className="truncate font-mono text-xs">{t.name}</span>
                <div className="flex gap-1 shrink-0">
                  {t.foreignKeys.length > 0 && (
                    <span className="text-[10px] text-blue-400">{t.foreignKeys.length}FK</span>
                  )}
                  {t.referencedBy.length > 0 && (
                    <span className="text-[10px] text-emerald-400">←{t.referencedBy.length}</span>
                  )}
                </div>
              </button>
            ))}
            {filteredTables.length === 0 && (
              <p className="px-4 py-6 text-center text-xs text-zinc-600">No {entityLabelPlural} match</p>
            )}
          </div>
        </aside>

        {/* Detail panel */}
        <main className="flex-1 overflow-y-auto p-6">
          {selectedTable ? (
            <TableDetail
              table={selectedTable}
              preview={preview}
              previewLoading={previewLoading}
              onPreview={handlePreview}
              onAsk={handleAsk}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-zinc-600">Select {isES ? 'an index' : 'a table'} to explore</p>
            </div>
          )}
        </main>
      </div>

      {/* Explain DB Modal */}
      {showExplain && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setShowExplain(false)}
        >
          <div
            className="relative w-full max-w-2xl rounded-2xl border border-zinc-700/60 bg-zinc-900 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/20">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
              </div>
              <h2 className="font-semibold text-white">{isES ? 'AI Cluster Summary' : 'AI Database Summary'}</h2>
              <button
                title="Close summary"
                aria-label="Close summary"
                onClick={() => setShowExplain(false)}
                className="ml-auto rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {explainLoading ? (
              <div className="flex items-center gap-3 py-8 justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <span className="text-sm text-zinc-400">Analysing schema with AI…</span>
              </div>
            ) : (
              <div className="overflow-y-auto max-h-[60vh]">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    p: ({ children }) => (
                      <p className="mb-3 text-sm leading-relaxed text-zinc-300 last:mb-0">{children}</p>
                    ),
                    strong: ({ children }) => (
                      <strong className="font-semibold text-white">{children}</strong>
                    ),
                    ul: ({ children }) => (
                      <ul className="my-2 ml-4 list-disc space-y-1 text-sm text-zinc-300">{children}</ul>
                    ),
                    ol: ({ children }) => (
                      <ol className="my-2 ml-4 list-decimal space-y-1 text-sm text-zinc-300">{children}</ol>
                    ),
                    h3: ({ children }) => (
                      <h3 className="mt-4 mb-1.5 text-sm font-semibold text-white">{children}</h3>
                    ),
                    code: ({ children }) => (
                      <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-xs text-indigo-300">
                        {children}
                      </code>
                    ),
                  }}
                >
                  {explainText ?? ''}
                </ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
