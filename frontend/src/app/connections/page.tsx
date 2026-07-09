'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { connectionApi } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Plus, Pencil, X, Zap, RefreshCw, Trash2, Search, Check, LogOut, Share2, UserX, Clock } from 'lucide-react';

// Auto-refresh cadences supported by the backend (RefreshScheduleDto.intervalMinutes).
const REFRESH_INTERVALS = [
  { value: 5,    label: 'Every 5 minutes' },
  { value: 15,   label: 'Every 15 minutes' },
  { value: 30,   label: 'Every 30 minutes' },
  { value: 60,   label: 'Every hour' },
  { value: 360,  label: 'Every 6 hours' },
  { value: 720,  label: 'Every 12 hours' },
  { value: 1440, label: 'Every day' },
];

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
  { type: 'fabric',        label: 'MS Fabric',       color: '#10B981', defaultPort: 1433  },
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
  editConn, onSaved, onCreated, onClose,
}: {
  
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
        const { connection } = await connectionApi.create({ ...payload, name: payload.name || '__tmp__' });
        connIdToTest = connection.id;
        // Store so we can reuse it on save
        (window as any).__tmpConnId = connIdToTest;
      }
      const result = await connectionApi.test(connIdToTest);
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
        const { connection } = await connectionApi.update(editConn.id, buildPayload());
        onSaved?.(connection);
      } else if (tmpId) {
        // Update the temp connection instead of creating another
        const { connection } = await connectionApi.update(tmpId, buildPayload());
        delete (window as any).__tmpConnId;
        onCreated?.(connection);
      } else {
        const { connection } = await connectionApi.create(buildPayload());
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

// ── Share dialog ────────────────────────────────────────────────
// Owner (or Admin) only. Lets the owner search Admins/Analysts, grant
// Read/Edit access, change an existing grant's level, or revoke it.
function ShareDialog({ conn, onClose }: { conn: any; onClose: () => void }) {
  const [shares, setShares] = useState<any[]>([]);
  const [loadingShares, setLoadingShares] = useState(true);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);
  const [level, setLevel] = useState<'view' | 'edit'>('view');
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { loadShares(); }, []);

  async function loadShares() {
    setLoadingShares(true);
    try {
      const { shares: s } = await connectionApi.listShares(conn.id);
      setShares(s);
    } catch (e) { console.error(e); }
    finally { setLoadingShares(false); }
  }

  // Debounced search — only surfaces Admins/Analysts not already shared with.
  useEffect(() => {
    setSelected(null);
    const q = query.trim();
    if (q.length < 2) { setResults([]); return; }
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const { users } = await connectionApi.searchShareTargets(q);
        const sharedIds = new Set(shares.map((s: any) => s.account_id));
        setResults(users.filter((u: any) => !sharedIds.has(u.id)));
      } catch (e) { console.error(e); }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(handle);
  }, [query, shares]);

  async function handleShare() {
    const email = selected?.email || query.trim();
    if (!email) return;
    setSharing(true); setError(null);
    try {
      await connectionApi.share(conn.id, { email, accessLevel: level });
      setQuery(''); setSelected(null); setResults([]);
      await loadShares();
    } catch (e: any) {
      setError(e?.message || 'Failed to share connection');
    } finally { setSharing(false); }
  }

  async function handleUpdateLevel(accountId: string, newLevel: 'view' | 'edit') {
    try {
      await connectionApi.updateShare(conn.id, accountId, { accessLevel: newLevel });
      setShares(s => s.map((x: any) => x.account_id === accountId ? { ...x, can_edit: newLevel === 'edit' } : x));
    } catch (e) { console.error(e); }
  }

  async function handleRevoke(accountId: string) {
    try {
      await connectionApi.revokeShare(conn.id, accountId);
      setShares(s => s.filter((x: any) => x.account_id !== accountId));
    } catch (e) { console.error(e); }
  }

  return (
    <div className="fixed inset-0 bg-black/25 backdrop-blur-[2px] z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: '85vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold text-foreground">Share — {conn.name}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          {/* Search + grant */}
          <div className="relative">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search Admins / Analysts by name or email…"
                  className={`${inputCls} pl-8`}
                />
              </div>
              <select value={level} onChange={e => setLevel(e.target.value as 'view' | 'edit')}
                className="px-2.5 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[#2B2B2B]/20">
                <option value="view">Read</option>
                <option value="edit">Edit</option>
              </select>
            </div>

            {(results.length > 0 || searching) && (
              <div className="absolute left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                {searching ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>
                ) : results.map((u: any) => (
                  <button
                    key={u.id}
                    onClick={() => { setSelected(u); setQuery(u.email); setResults([]); }}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/60 transition-colors"
                  >
                    <span className="text-xs text-foreground truncate">{u.display_name || u.email}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{u.role}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button onClick={handleShare} disabled={sharing || !query.trim()}
            className="w-full px-4 py-2 bg-[#2B2B2B] hover:bg-[#3a3a3a] text-white rounded-lg text-sm font-semibold disabled:opacity-40 transition-colors">
            {sharing ? 'Sharing…' : 'Share'}
          </button>
          {error && <p className="text-xs text-destructive">{error}</p>}

          {/* Current access */}
          <div className="pt-2 border-t border-border space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Who has access</p>
            {loadingShares ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : shares.length === 0 ? (
              <p className="text-xs text-muted-foreground">Not shared with anyone yet.</p>
            ) : shares.map((s: any) => (
              <div key={s.account_id} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-foreground truncate">{s.display_name || s.email}</p>
                  <p className="text-xs text-muted-foreground truncate">{s.email}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <select
                    value={s.can_edit ? 'edit' : 'view'}
                    onChange={e => handleUpdateLevel(s.account_id, e.target.value as 'view' | 'edit')}
                    className="px-2 py-1 bg-muted border border-border rounded-md text-xs text-foreground focus:outline-none"
                  >
                    <option value="view">Read</option>
                    <option value="edit">Edit</option>
                  </select>
                  <button
                    onClick={() => handleRevoke(s.account_id)}
                    title="Revoke access"
                    className="p-1.5 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                  >
                    <UserX className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Auto Refresh dialog ──────────────────────────────────────────
// Owner (or Admin) only. Lets the owner enable/disable scheduled refresh,
// pick an interval, and see the last/next run + current status.
function AutoRefreshDialog({ conn, onClose }: { conn: any; onClose: () => void }) {
  const [schedule, setSchedule] = useState<any>(null);
  const [loadingSchedule, setLoadingSchedule] = useState(true);
  const [interval, setIntervalMinutes] = useState(60);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { loadSchedule(); }, []);

  async function loadSchedule() {
    setLoadingSchedule(true);
    try {
      const { schedule: s } = await connectionApi.getRefreshSchedule(conn.id);
      setSchedule(s);
      if (s?.refresh_interval_minutes) setIntervalMinutes(s.refresh_interval_minutes);
    } catch (e) { console.error(e); }
    finally { setLoadingSchedule(false); }
  }

  async function handleSave(enabled: boolean, intervalMinutes?: number) {
    setSaving(true); setError(null);
    try {
      const { schedule: s } = await connectionApi.setRefreshSchedule(conn.id, { enabled, intervalMinutes });
      setSchedule(s);
    } catch (e: any) {
      setError(e?.message || 'Failed to update auto-refresh schedule');
    } finally { setSaving(false); }
  }

  const enabled = !!schedule?.refresh_enabled;

  return (
    <div className="fixed inset-0 bg-black/25 backdrop-blur-[2px] z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: '85vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold text-foreground">Auto Refresh — {conn.name}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          {loadingSchedule ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">Enable Auto Refresh</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Automatically re-sync the schema on an interval</p>
                </div>
                <button
                  role="switch"
                  aria-checked={enabled}
                  onClick={() => handleSave(!enabled, interval)}
                  disabled={saving}
                  className={`relative inline-flex items-center h-6 w-11 rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-50 shrink-0 ${
                    enabled ? 'bg-[#2B2B2B]' : 'bg-border'
                  }`}
                >
                  <span className={`inline-block w-5 h-5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                    enabled ? 'translate-x-[22px]' : 'translate-x-0.5'
                  }`} />
                </button>
              </div>

              {enabled && (
                <div className="flex flex-wrap gap-1.5">
                  {REFRESH_INTERVALS.map(opt => (
                    <button key={opt.value}
                      onClick={() => { setIntervalMinutes(opt.value); handleSave(true, opt.value); }}
                      disabled={saving}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-50 ${
                        interval === opt.value
                          ? 'bg-[#2B2B2B] text-white shadow-sm'
                          : 'bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground border border-border'
                      }`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
              {error && <p className="text-xs text-destructive">{error}</p>}

              <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border text-xs">
                <div>
                  <p className="text-muted-foreground">Last Refresh</p>
                  <p className="text-foreground font-medium mt-0.5">
                    {schedule?.last_refresh_at ? new Date(schedule.last_refresh_at).toLocaleString() : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Next Refresh</p>
                  <p className="text-foreground font-medium mt-0.5">
                    {schedule?.next_refresh_at ? new Date(schedule.next_refresh_at).toLocaleString() : '—'}
                  </p>
                </div>
              </div>

              <div className="text-xs">
                <p className="text-muted-foreground">Current Status</p>
                {schedule?.last_refresh_status ? (
                  <p className={`font-medium mt-0.5 ${schedule.last_refresh_status === 'success' ? 'text-green-600' : 'text-destructive'}`}>
                    {schedule.last_refresh_status === 'success' ? 'Succeeded' : `Failed — ${schedule.last_refresh_error || 'unknown error'}`}
                  </p>
                ) : (
                  <p className="text-foreground font-medium mt-0.5">No refresh has run yet</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Data Sources page ──────────────────────────────────────────
export default function DataSourcesPage() {
  const router = useRouter();
  const role = useAuthStore(s => s.user?.role);
  const canCreate = role !== 'VIEWER';

  const [connections, setConnections] = useState<any[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [syncing,     setSyncing]     = useState<string | null>(null);
  const [editConn,    setEditConn]    = useState<any | null>(null);
  const [showNew,     setShowNew]     = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [sharingConn, setSharingConn] = useState<any | null>(null);
  const [refreshConn, setRefreshConn] = useState<any | null>(null);
  const [toastMsg, setToastMsg] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToastMsg({ message, type });
    setTimeout(() => setToastMsg(null), 3000);
  };

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const { connections: conns } = await connectionApi.list();
      setConnections(conns);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function handleSync(connId: string) {
    setSyncing(connId);
    try {
      await connectionApi.syncSchema(connId);
      setConnections(cs => cs.map(c =>
        c.id === connId ? { ...c, schema_synced_at: new Date().toISOString() } : c
      ));
    } finally { setSyncing(null); }
  }

  const [leaving, setLeaving] = useState<string | null>(null);

  /** Remove a shared connection from this user's own workspace — never deletes it. */
  async function handleLeave(connId: string) {
    setLeaving(connId);
    try {
      await connectionApi.leaveShared(connId);
      setConnections(cs => cs.filter(c => c.id !== connId));
      showToast('Removed from your workspace', 'success');
    } catch (e: any) {
      console.error(e);
      showToast(e?.message || 'Failed to remove connection', 'error');
    } finally { setLeaving(null); }
  }

  const [deleting, setDeleting] = useState(false);

  async function performDelete(connId: string) {
    if (deleting) return; // guard against duplicate invocation (double-click, slow re-render)
    setDeleting(true);
    try {
      await connectionApi.delete(connId);
      setConnections(cs => cs.filter(c => c.id !== connId));
      setConfirmingDeleteId(null);
      showToast('Connection deleted successfully', 'success');
    } catch (e: any) {
      console.error(e);
      showToast(e?.message || 'Failed to delete connection', 'error');
    } finally { setDeleting(false); }
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
          {canCreate && (
            <button
              onClick={() => setShowNew(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-[#2B2B2B] hover:bg-[#3a3a3a] text-white rounded-lg text-sm font-semibold transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add Connection
            </button>
          )}
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
            {canCreate && (
              <button onClick={() => setShowNew(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#2B2B2B] text-white rounded-lg text-sm font-semibold hover:bg-[#3a3a3a] transition-colors">
                <Plus className="w-3.5 h-3.5" /> Add Connection
              </button>
            )}
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl overflow-hidden divide-y divide-border">
            {connections.map((conn: any) => {
              const meta   = connectorMeta(conn.connector_type);
              const status = STATUS[conn.status as keyof typeof STATUS] ?? STATUS.inactive;
              const isSyncing = syncing === conn.id;
              const isLeaving = leaving === conn.id;
              const isOwner = conn.access_level === 'owner';
              const canEdit = isOwner || conn.access_level === 'edit';

              return (
                <div key={conn.id} className="group flex items-center hover:bg-muted/30 transition-colors">
                  {/* Clickable info area → connection chat */}
                  <div
                    onClick={() => router.push(`/connections/${conn.id}/chat`)}
                    className="flex items-center gap-4 flex-1 min-w-0 px-4 py-3.5 cursor-pointer"
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
                  </div>

                  {/* Actions — visible on hover. Only owners (or Admin) may edit/delete; never shown to shared users. */}
                  <div className="flex items-center gap-1 pr-4 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    {canEdit && (
                      <button
                        onClick={() => handleSync(conn.id)}
                        disabled={isSyncing}
                        title="Sync schema"
                        className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 transition-colors"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                      </button>
                    )}
                    {isOwner && (
                      <button
                        onClick={() => setRefreshConn(conn)}
                        title="Auto Refresh"
                        className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                      >
                        <Clock className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {isOwner ? (
                      <button
                        onClick={() => setConfirmingDeleteId(conn.id)}
                        title="Delete"
                        className="p-1.5 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleLeave(conn.id)}
                        disabled={isLeaving}
                        title="Remove from my workspace"
                        className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 transition-colors"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {isOwner && (
                      <button
                        onClick={() => setSharingConn(conn)}
                        title="Share"
                        className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {isOwner && (
                      <button
                        onClick={() => setEditConn(conn)}
                        className="flex items-center gap-1 px-2.5 py-1.5 ml-0.5 bg-muted hover:bg-[#2B2B2B] hover:text-white rounded-md text-xs font-semibold text-muted-foreground transition-all"
                      >
                        <Pencil className="w-3 h-3" /> Edit
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modals */}
      {showNew && (
        <ConnectionModal

          editConn={null}
          onCreated={conn => setConnections(cs => [conn, ...cs])}
          onClose={() => setShowNew(false)}
        />
      )}

      {editConn && (
        <ConnectionModal

          editConn={editConn}
          onSaved={updated => setConnections(cs => cs.map(c => c.id === updated.id ? { ...c, ...updated } : c))}
          onClose={() => setEditConn(null)}
        />
      )}

      {sharingConn && (
        <ShareDialog conn={sharingConn} onClose={() => setSharingConn(null)} />
      )}

      {refreshConn && (
        <AutoRefreshDialog conn={refreshConn} onClose={() => setRefreshConn(null)} />
      )}

      {/* Delete connection confirmation */}
      {confirmingDeleteId && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => !deleting && setConfirmingDeleteId(null)}
        >
          <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-xl p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-destructive" />
              </div>
              <h2 className="text-base font-semibold text-foreground">
                Delete {connections.find(c => c.id === confirmingDeleteId)?.name || 'connection'}?
              </h2>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed mb-6">
              This action will permanently delete the data source connection and all related
              dashboards, chats, history, and generated artifacts. This action cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => performDelete(confirmingDeleteId)}
                disabled={deleting}
                className="flex-1 py-2.5 bg-destructive hover:opacity-90 text-white rounded-xl text-sm font-semibold disabled:opacity-40 transition-opacity"
              >
                {deleting ? 'Deleting…' : 'Yes, delete connection'}
              </button>
              <button
                onClick={() => setConfirmingDeleteId(null)}
                disabled={deleting}
                className="px-5 py-2.5 bg-muted hover:bg-muted/80 rounded-xl text-sm text-muted-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-5">
          <div className={`px-4 py-2.5 rounded-xl text-sm font-semibold shadow-lg border ${
            toastMsg.type === 'success' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'
          }`}>
            {toastMsg.message}
          </div>
        </div>
      )}
    </div>
  );
}
