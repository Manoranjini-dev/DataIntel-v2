'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { connectionApi, orgApi } from '@/lib/api';
import { Plus, Pencil, X, Zap, RefreshCw, Trash2, Search, Check } from 'lucide-react';

// ── Connector registry ─────────────────────────────────────────
const CONNECTORS = [
  { type: 'postgres',      label: 'PostgreSQL',     color: '#336791', defaultPort: 5432  },
  { type: 'mysql',         label: 'MySQL',           color: '#00758F', defaultPort: 3306  },
  { type: 'mssql',         label: 'SQL Server',      color: '#CC2927', defaultPort: 1433  },
  { type: 'snowflake',     label: 'Snowflake',       color: '#29B5E8', defaultPort: 443   },
  { type: 'bigquery',      label: 'BigQuery',        color: '#4285F4', defaultPort: 0     },
  { type: 'databricks',    label: 'Databricks',      color: '#FF3621', defaultPort: 443   },
  { type: 'mongodb',       label: 'MongoDB',         color: '#47A248', defaultPort: 27017 },
  { type: 'elasticsearch', label: 'Elasticsearch',   color: '#FEC514', defaultPort: 9200  },
  { type: 'redshift',      label: 'Redshift',        color: '#8C4FFF', defaultPort: 5439  },
] as const;

type ConnType = typeof CONNECTORS[number]['type'];

function connectorMeta(type: string) {
  return CONNECTORS.find(c => c.type === type) ?? { label: type, color: '#888', defaultPort: 0 };
}

// Which field groups apply per connector
function fieldsFor(type: ConnType) {
  const base = { host: true, port: true, database: false, username: true, password: true, ssl: true };
  const overrides: Partial<Record<ConnType, Partial<typeof base & {
    database: boolean; httpPath: boolean; catalog: boolean; projectId: boolean; datasetId: boolean;
  }>>> = {
    postgres:      { database: true },
    mysql:         { database: true },
    mssql:         { database: true },
    snowflake:     { database: true },
    redshift:      { database: true },
    mongodb:       { database: true },
    elasticsearch: {},
    databricks:    { port: false, database: false, ssl: false },
    bigquery:      { host: false, port: false, username: false, password: false, ssl: false },
  };
  return { ...base, ...overrides[type] };
}

const STATUS = {
  active:   { color: '#22c55e', label: 'Active'   },
  inactive: { color: '#9ca3af', label: 'Inactive' },
  error:    { color: '#ef4444', label: 'Error'    },
  testing:  { color: '#f59e0b', label: 'Testing'  },
} as const;

// ── Shared field-by-field input components ─────────────────────
const inputCls = 'w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-[#2B2B2B]/20 focus:border-[#2B2B2B]/40 transition-all';

interface ConnForm {
  name: string; host: string; port: string; databaseName: string;
  username: string; password: string; ssl: boolean;
  databricksHttpPath: string; bigqueryProjectId: string; bigqueryDatasetId: string; bigqueryKeyJson: string;
}

const BLANK: ConnForm = {
  name: '', host: '', port: '', databaseName: '', username: '', password: '',
  ssl: false, databricksHttpPath: '', bigqueryProjectId: '', bigqueryDatasetId: '', bigqueryKeyJson: '',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      {children}
    </div>
  );
}

function ToggleSwitch({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer select-none">
      <div
        onClick={onChange}
        className={`w-8 h-[18px] rounded-full transition-colors flex items-center px-0.5 shrink-0 ${checked ? 'bg-[#2B2B2B]' : 'bg-border'}`}
      >
        <div className={`w-3.5 h-3.5 bg-white rounded-full shadow-sm transition-transform ${checked ? 'translate-x-[14px]' : ''}`} />
      </div>
      <span className="text-sm text-foreground">{label}</span>
    </label>
  );
}

function FormFields({ type, form, setForm }: {
  type: ConnType;
  form: ConnForm;
  setForm: (fn: (f: ConnForm) => ConnForm) => void;
}) {
  const f = fieldsFor(type);
  const set = (k: keyof ConnForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  return (
    <div className="space-y-3.5">
      <Field label="Display name *">
        <input value={form.name} onChange={set('name')} placeholder="e.g. Production DB" className={inputCls} autoFocus />
      </Field>

      {/* BigQuery needs project/dataset + key JSON */}
      {type === 'bigquery' ? (
        <>
          <Field label="Project ID *">
            <input value={form.bigqueryProjectId} onChange={set('bigqueryProjectId')} placeholder="my-gcp-project" className={inputCls} />
          </Field>
          <Field label="Dataset (optional)">
            <input value={form.bigqueryDatasetId} onChange={set('bigqueryDatasetId')} placeholder="analytics" className={inputCls} />
          </Field>
          <Field label="Service account key (JSON) *">
            <textarea value={form.bigqueryKeyJson} onChange={set('bigqueryKeyJson')}
              placeholder={'{\n  "type": "service_account",\n  ...\n}'}
              rows={5} className={`${inputCls} font-mono text-xs resize-none`} />
          </Field>
        </>
      ) : type === 'databricks' ? (
        <>
          <Field label="Server hostname *">
            <input value={form.host} onChange={set('host')} placeholder="xxx.azuredatabricks.net" className={inputCls} />
          </Field>
          <Field label="HTTP path *">
            <input value={form.databricksHttpPath} onChange={set('databricksHttpPath')}
              placeholder="/sql/1.0/warehouses/abc123" className={inputCls} />
          </Field>
          <Field label="Personal access token *">
            <input value={form.password} onChange={set('password')} type="password"
              placeholder="dapi••••••••••••••••" className={inputCls} />
          </Field>
        </>
      ) : (
        <>
          <div className={`grid gap-3 ${f.port ? 'grid-cols-[1fr_100px]' : 'grid-cols-1'}`}>
            {f.host && (
              <Field label="Host *">
                <input value={form.host} onChange={set('host')} placeholder="localhost" className={inputCls} />
              </Field>
            )}
            {f.port && (
              <Field label="Port">
                <input value={form.port} onChange={set('port')} type="number" className={inputCls} />
              </Field>
            )}
          </div>

          {f.database && (
            <Field label="Database *">
              <input value={form.databaseName} onChange={set('databaseName')} placeholder="my_database" className={inputCls} />
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            {f.username && (
              <Field label="Username">
                <input value={form.username} onChange={set('username')} placeholder="readonly" autoComplete="off" className={inputCls} />
              </Field>
            )}
            <Field label="Password">
              <input value={form.password} onChange={set('password')} type="password" placeholder="••••••••" autoComplete="new-password" className={inputCls} />
            </Field>
          </div>

          {f.ssl && (
            <ToggleSwitch checked={form.ssl} onChange={() => setForm(f => ({ ...f, ssl: !f.ssl }))} label="Use SSL / TLS" />
          )}
        </>
      )}
    </div>
  );
}

// ── Two-column Add/Edit modal ──────────────────────────────────
function ConnectionModal({
  orgId, editConn, onSaved, onCreated, onClose,
}: {
  orgId: string;
  editConn: any | null;
  onSaved?: (c: any) => void;
  onCreated?: (c: any) => void;
  onClose: () => void;
}) {
  const isEdit = !!editConn;

  const [selectedType, setSelectedType] = useState<ConnType>(
    editConn?.connector_type ?? 'postgres'
  );
  const [search,  setSearch]  = useState('');
  const [form,    setForm]    = useState<ConnForm>({
    ...BLANK,
    name:         editConn?.name          ?? '',
    host:         editConn?.host          ?? '',
    port:         String(editConn?.port ?? (connectorMeta(editConn?.connector_type ?? 'postgres').defaultPort || '')),
    databaseName: editConn?.database_name ?? '',
    username:     editConn?.username      ?? '',
    ssl:          editConn?.ssl           ?? false,
  });
  const [saving,  setSaving]  = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const filteredConnectors = useMemo(() =>
    CONNECTORS.filter(c => c.label.toLowerCase().includes(search.toLowerCase())),
    [search]
  );

  function handleSelectType(type: ConnType) {
    if (isEdit) return; // can't change type when editing
    const meta = connectorMeta(type);
    setSelectedType(type);
    setForm(f => ({ ...f, port: meta.defaultPort ? String(meta.defaultPort) : '' }));
    setTestMsg(null);
  }

  async function handleTest() {
    setTesting(true); setTestMsg(null);
    try {
      let connIdToTest = editConn?.id;
      if (!connIdToTest) {
        // create temporary, test, then clean up on save/cancel
        const payload = buildPayload();
        const { connection } = await connectionApi.create(orgId, { ...payload, name: payload.name || '__tmp__' });
        connIdToTest = connection.id;
        // Store so we can reuse it on save
        (window as any).__tmpConnId = connIdToTest;
      }
      const result = await connectionApi.test(orgId, connIdToTest);
      setTestMsg({ ok: result.success, text: result.success ? 'Connection successful' : 'Connection failed — check credentials' });
    } catch (e: any) {
      setTestMsg({ ok: false, text: e?.message ?? 'Connection failed' });
    } finally { setTesting(false); }
  }

  function buildPayload() {
    return {
      name:           form.name,
      connectorType:  selectedType,
      host:           form.host,
      port:           Number(form.port) || undefined,
      databaseName:   form.databaseName,
      username:       form.username,
      password:       form.password || undefined,
      ssl:            form.ssl,
      databricksHttpPath:  form.databricksHttpPath || undefined,
      bigqueryProjectId:   form.bigqueryProjectId || undefined,
      bigqueryDatasetId:   form.bigqueryDatasetId || undefined,
      bigqueryKeyJson:     form.bigqueryKeyJson    || undefined,
    };
  }

  async function handleSave() {
    setSaving(true);
    try {
      const tmpId = (window as any).__tmpConnId as string | undefined;
      if (isEdit) {
        const { connection } = await connectionApi.update(orgId, editConn.id, buildPayload());
        onSaved?.(connection);
      } else if (tmpId) {
        // Update the temp connection instead of creating another
        const { connection } = await connectionApi.update(orgId, tmpId, buildPayload());
        delete (window as any).__tmpConnId;
        onCreated?.(connection);
      } else {
        const { connection } = await connectionApi.create(orgId, buildPayload());
        onCreated?.(connection);
      }
      onClose();
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  }

  const meta = connectorMeta(selectedType);
  const canSave = form.name.trim() && (form.host.trim() || selectedType === 'bigquery');

  return (
    <div className="fixed inset-0 bg-black/25 backdrop-blur-[2px] z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-2xl w-full shadow-2xl flex flex-col overflow-hidden"
        style={{ maxWidth: 820, maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold text-foreground">
            {isEdit ? `Edit — ${editConn.name}` : 'Add Connection'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body — two columns */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* Left: connector type list */}
          <div className="w-48 border-r border-border flex flex-col shrink-0 bg-muted/20">
            <div className="p-3 border-b border-border">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
                <input
                  value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search…"
                  className="w-full pl-8 pr-3 py-1.5 bg-background border border-border rounded-lg text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-[#2B2B2B]/20 transition-all"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {filteredConnectors.map(c => {
                const active = selectedType === c.type;
                return (
                  <button
                    key={c.type}
                    onClick={() => handleSelectType(c.type)}
                    disabled={isEdit}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                      active
                        ? 'bg-[#2B2B2B] text-white'
                        : isEdit
                        ? 'text-muted-foreground cursor-default'
                        : 'text-foreground hover:bg-muted/60'
                    }`}
                  >
                    <span
                      className="w-5 h-5 rounded shrink-0 flex items-center justify-center text-[10px] font-black text-white"
                      style={{ background: c.color }}
                    >
                      {c.label[0]}
                    </span>
                    <span className="text-xs font-medium flex-1 truncate">{c.label}</span>
                    {active && <Check className="w-3 h-3 text-[#F5A623] shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: form */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="mb-5 flex items-center gap-2.5">
              <span
                className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black text-white shrink-0"
                style={{ background: meta.color }}
              >
                {meta.label[0]}
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">{meta.label}</p>
                {!isEdit && <p className="text-[11px] text-muted-foreground">Fill in the connection details below</p>}
              </div>
            </div>

            <FormFields type={selectedType} form={form} setForm={setForm} />
          </div>
        </div>

        {/* Sticky footer */}
        <div className="border-t border-border px-6 py-3.5 bg-card flex items-center gap-2 shrink-0">
          {testMsg && (
            <div className={`flex items-center gap-1.5 text-xs mr-auto ${testMsg.ok ? 'text-green-600' : 'text-red-600'}`}>
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${testMsg.ok ? 'bg-green-500' : 'bg-red-500'}`} />
              {testMsg.text}
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={onClose}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
              Cancel
            </button>
            <button onClick={handleTest} disabled={testing || !form.host.trim()}
              className="flex items-center gap-1.5 px-4 py-2 bg-muted hover:bg-muted/80 border border-border rounded-lg text-sm font-medium text-foreground disabled:opacity-40 transition-colors">
              <Zap className={`w-3.5 h-3.5 ${testing ? 'text-amber-500' : ''}`} />
              {testing ? 'Testing…' : 'Test Connection'}
            </button>
            <button onClick={handleSave} disabled={!canSave || saving}
              className="px-5 py-2 bg-[#2B2B2B] hover:bg-[#3a3a3a] text-white rounded-lg text-sm font-semibold disabled:opacity-40 transition-colors">
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Save Connection'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Data Sources page ──────────────────────────────────────────
export default function DataSourcesPage() {
  const { slug } = useParams<{ slug: string }>();

  const [org,         setOrg]         = useState<any>(null);
  const [connections, setConnections] = useState<any[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [syncing,     setSyncing]     = useState<string | null>(null);
  const [editConn,    setEditConn]    = useState<any | null>(null);
  const [showNew,     setShowNew]     = useState(false);

  useEffect(() => { loadData(); }, [slug]);

  async function loadData() {
    try {
      const { org: o } = await orgApi.get(slug);
      setOrg(o);
      const { connections: conns } = await connectionApi.list(o.id);
      setConnections(conns);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function handleSync(connId: string) {
    if (!org) return;
    setSyncing(connId);
    try {
      await connectionApi.syncSchema(org.id, connId);
      setConnections(cs => cs.map(c =>
        c.id === connId ? { ...c, schema_synced_at: new Date().toISOString() } : c
      ));
    } finally { setSyncing(null); }
  }

  async function handleDelete(connId: string, name: string) {
    if (!org || !window.confirm(`Delete "${name}"?`)) return;
    try {
      await connectionApi.delete(org.id, connId);
      setConnections(cs => cs.filter(c => c.id !== connId));
    } catch (e) { console.error(e); }
  }

  return (
    <div className="flex-1 overflow-auto bg-background">
      <div className="max-w-2xl mx-auto px-8 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Data Sources</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {connections.length} connection{connections.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-[#2B2B2B] hover:bg-[#3a3a3a] text-white rounded-lg text-sm font-semibold transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add Connection
          </button>
        </div>

        {/* Connection list */}
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : connections.length === 0 ? (
          <div className="text-center py-20 border border-dashed border-border rounded-xl">
            <p className="text-sm font-medium text-foreground mb-1">No connections yet</p>
            <p className="text-xs text-muted-foreground mb-5">
              Connect a database or warehouse to start querying
            </p>
            <button onClick={() => setShowNew(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#2B2B2B] text-white rounded-lg text-sm font-semibold hover:bg-[#3a3a3a] transition-colors">
              <Plus className="w-3.5 h-3.5" /> Add Connection
            </button>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl overflow-hidden divide-y divide-border">
            {connections.map((conn: any) => {
              const meta   = connectorMeta(conn.connector_type);
              const status = STATUS[conn.status as keyof typeof STATUS] ?? STATUS.inactive;
              const isSyncing = syncing === conn.id;

              return (
                <div key={conn.id} className="group flex items-center hover:bg-muted/30 transition-colors">
                  {/* Clickable info area → connection chat */}
                  <Link
                    href={`/orgs/${slug}/connections/${conn.id}/chat`}
                    className="flex items-center gap-4 flex-1 min-w-0 px-4 py-3.5"
                  >
                    {/* Icon */}
                    <span
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black text-white shrink-0"
                      style={{ background: meta.color }}
                    >
                      {meta.label[0]}
                    </span>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-foreground truncate">{conn.name}</p>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: status.color }} />
                          <span className="text-[10px] text-muted-foreground font-medium">{status.label}</span>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {meta.label}
                        {conn.host ? ` · ${conn.host}${conn.port ? `:${conn.port}` : ''}` : ''}
                        {conn.database_name ? ` · ${conn.database_name}` : ''}
                      </p>
                    </div>
                  </Link>

                  {/* Actions — visible on hover */}
                  <div className="flex items-center gap-1 pr-4 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button
                      onClick={() => handleSync(conn.id)}
                      disabled={isSyncing}
                      title="Sync schema"
                      className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 transition-colors"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                      onClick={() => handleDelete(conn.id, conn.name)}
                      title="Delete"
                      className="p-1.5 rounded-md text-muted-foreground hover:bg-red-50 hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setEditConn(conn)}
                      className="flex items-center gap-1 px-2.5 py-1.5 ml-0.5 bg-muted hover:bg-[#2B2B2B] hover:text-white rounded-md text-xs font-semibold text-muted-foreground transition-all"
                    >
                      <Pencil className="w-3 h-3" /> Edit
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modals */}
      {showNew && org && (
        <ConnectionModal
          orgId={org.id}
          editConn={null}
          onCreated={conn => setConnections(cs => [conn, ...cs])}
          onClose={() => setShowNew(false)}
        />
      )}

      {editConn && org && (
        <ConnectionModal
          orgId={org.id}
          editConn={editConn}
          onSaved={updated => setConnections(cs => cs.map(c => c.id === updated.id ? { ...c, ...updated } : c))}
          onClose={() => setEditConn(null)}
        />
      )}
    </div>
  );
}
