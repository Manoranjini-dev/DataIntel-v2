'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { connectionApi, orgApi } from '@/lib/api';
import {
  Code2, Zap, BarChart3, Rows3, Keyboard, Trash2, Radio,
  TestTube2, Database, ShieldAlert, CheckCircle2, RefreshCw, Check, X,
} from 'lucide-react';

// ── Design Components ──────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/50 shrink-0 ${
        checked ? 'bg-primary' : 'bg-muted border border-border'
      }`}
    >
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
        checked ? 'translate-x-5' : 'translate-x-0.5'
      }`} />
    </button>
  );
}

function SettingCard({
  icon: Icon,
  iconColor = 'text-primary',
  iconBg = 'bg-primary/10',
  title,
  description,
  right,
  subtle,
}: {
  icon: React.ElementType;
  iconColor?: string;
  iconBg?: string;
  title: string;
  description: string;
  right: React.ReactNode;
  subtle?: boolean;
}) {
  return (
    <div className={`flex items-center gap-4 px-5 py-4 rounded-2xl border transition-colors ${
      subtle
        ? 'bg-transparent border-border/50 hover:bg-muted/30'
        : 'bg-card border-border hover:border-primary/20'
    }`}
      style={{ boxShadow: subtle ? 'none' : '0 1px 4px rgba(0,0,0,.04)' }}
    >
      <div className={`w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center shrink-0`}>
        <Icon className={`w-5 h-5 ${iconColor}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
      </div>
      <div className="shrink-0 ml-2">{right}</div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-[13px] font-semibold text-foreground uppercase tracking-widest">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────

export default function ConnectionSettingsPage() {
  const { slug, connId } = useParams<{ slug: string; connId: string }>();
  const router = useRouter();

  const [conn, setConn] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [sessionCleared, setSessionCleared] = useState(false);
  const [org, setOrg] = useState<any>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Query / execution preferences
  const [showGeneratedQuery, setShowGeneratedQuery] = useState(false);
  const [autoExecute, setAutoExecute] = useState(true);
  const [streamResults, setStreamResults] = useState(true);
  const [rowLimit, setRowLimit] = useState<100 | 250 | 500>(500);

  // Dashboard preferences
  const [enableDashboard, setEnableDashboard] = useState(true);
  const [autoSaveWidgets, setAutoSaveWidgets] = useState(true);

  // AI preferences
  const [includeSchemaHints, setIncludeSchemaHints] = useState(true);
  const [showExplanations, setShowExplanations] = useState(true);

  // Edit credentials
  const [editMode, setEditMode] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  useEffect(() => { loadData(); }, [connId]);

  async function loadData() {
    try {
      const { org: orgData } = await orgApi.get(slug);
      setOrg(orgData);
      const { connection } = await connectionApi.get(orgData.id, connId);
      setConn(connection);
      setEditName(connection?.name ?? '');
      setEditDescription(connection?.description ?? '');
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function handleTest() {
    if (!org) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await connectionApi.test(org.id, connId);
      setTestResult({ success: result.success, message: result.success ? 'Connection successful' : 'Connection failed' });
    } catch (e: any) {
      setTestResult({ success: false, message: e?.message ?? 'Connection failed' });
    } finally { setTesting(false); }
  }

  async function handleSaveCredentials(e: React.FormEvent) {
    e.preventDefault();
    if (!org) return;
    setSaving(true);
    try {
      await connectionApi.update(org.id, connId, { name: editName, description: editDescription });
      setSaveSuccess(true);
      await loadData();
      setTimeout(() => { setSaveSuccess(false); setEditMode(false); }, 2000);
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  }

  function handleClearSession() {
    if (typeof window !== 'undefined') {
      Object.keys(localStorage)
        .filter(k => k.includes(connId))
        .forEach(k => localStorage.removeItem(k));
    }
    setSessionCleared(true);
    setTimeout(() => setSessionCleared(false), 3000);
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 p-8 overflow-auto animate-fade-in">
      <div className="max-w-2xl mx-auto space-y-10">

        {/* Page header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Connection Settings</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Configure preferences for <span className="text-foreground font-medium">{conn?.name ?? 'this connection'}</span>
          </p>
        </div>

        {/* Connection identity */}
        <Section
          title="Identity"
          subtitle="Name and description shown across the workspace"
        >
          {!editMode ? (
            <div className="px-5 py-4 rounded-2xl bg-card border border-border" style={{ boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Database className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{conn?.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {conn?.connector_type} · {conn?.host}:{conn?.port}
                    </p>
                    {conn?.description && (
                      <p className="text-xs text-muted-foreground mt-1">{conn.description}</p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setEditMode(true)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/80 text-foreground font-medium transition-colors border border-border"
                >
                  Edit
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSaveCredentials} className="px-5 py-4 rounded-2xl bg-card border border-primary/30 space-y-3" style={{ boxShadow: '0 0 0 3px rgba(217,122,30,.08)' }}>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Name</label>
                <input
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  className="w-full px-3 py-2 bg-muted/50 border border-border rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Description</label>
                <input
                  value={editDescription}
                  onChange={e => setEditDescription(e.target.value)}
                  placeholder="Optional description..."
                  className="w-full px-3 py-2 bg-muted/50 border border-border rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button type="submit" disabled={saving}
                  className="px-4 py-2 bg-primary text-white rounded-xl text-xs font-semibold disabled:opacity-50 hover:opacity-90 transition-opacity">
                  {saving ? 'Saving…' : saveSuccess ? '✓ Saved' : 'Save'}
                </button>
                <button type="button" onClick={() => setEditMode(false)}
                  className="px-4 py-2 bg-muted hover:bg-muted/80 text-muted-foreground rounded-xl text-xs font-medium transition-colors">
                  Cancel
                </button>
              </div>
            </form>
          )}
        </Section>

        {/* Query Display */}
        <Section
          title="Query & Execution"
          subtitle="Control how AI-generated queries are shown and executed"
        >
          <SettingCard
            icon={Code2}
            title="Show Generated SQL"
            description="Display the generated SQL or query DSL alongside your results in the chat workspace"
            right={<Toggle checked={showGeneratedQuery} onChange={setShowGeneratedQuery} />}
          />
          <SettingCard
            icon={Zap}
            title="Auto-Execute Queries"
            description="Automatically run validated queries without waiting for manual approval — recommended for trusted connections"
            right={<Toggle checked={autoExecute} onChange={setAutoExecute} />}
          />
          <SettingCard
            icon={Radio}
            title="Stream Results"
            description="Stream large result sets progressively rather than waiting for the full response"
            right={<Toggle checked={streamResults} onChange={setStreamResults} />}
          />

          {/* Row limit selector */}
          <div className="flex items-center gap-4 px-5 py-4 rounded-2xl bg-card border border-border"
            style={{ boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}>
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Rows3 className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">Max Rows Per Query</p>
              <p className="text-xs text-muted-foreground mt-0.5">LIMIT injected into every generated query</p>
            </div>
            <div className="flex gap-1.5 shrink-0">
              {([100, 250, 500] as const).map(n => (
                <button key={n} onClick={() => setRowLimit(n)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    rowLimit === n
                      ? 'bg-primary text-white shadow-sm'
                      : 'bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground border border-border'
                  }`}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        </Section>

        {/* Dashboard */}
        <Section
          title="Dashboard"
          subtitle="Widget and layout preferences for this connection's dashboard"
        >
          <SettingCard
            icon={BarChart3}
            title="Enable Dashboard"
            description="Show the dashboard builder for creating drag-and-drop analytics widgets"
            right={<Toggle checked={enableDashboard} onChange={setEnableDashboard} />}
          />
          <SettingCard
            icon={RefreshCw}
            title="Auto-Save Widget Layouts"
            description="Automatically persist layout changes after every drag or resize"
            right={<Toggle checked={autoSaveWidgets} onChange={setAutoSaveWidgets} />}
          />
        </Section>

        {/* AI */}
        <Section
          title="AI Preferences"
          subtitle="Control how the AI interprets and explains your data"
        >
          <SettingCard
            icon={Database}
            title="Include Schema Hints"
            description="Send table names, column types, and relationships to the AI for more accurate queries"
            right={<Toggle checked={includeSchemaHints} onChange={setIncludeSchemaHints} />}
          />
          <SettingCard
            icon={Code2}
            iconColor="text-secondary"
            iconBg="bg-secondary/10"
            title="Show Query Explanations"
            description="Display a plain-English explanation of the generated query beneath the SQL"
            right={<Toggle checked={showExplanations} onChange={setShowExplanations} />}
          />
        </Section>

        {/* Keyboard shortcuts */}
        <Section title="Keyboard Shortcuts">
          <div className="px-5 py-4 rounded-2xl bg-card border border-border space-y-3"
            style={{ boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}>
            <div className="flex items-center gap-3 mb-3 pb-3 border-b border-border">
              <Keyboard className="w-4 h-4 text-muted-foreground" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Shortcuts</p>
            </div>
            {[
              { action: 'Focus chat input',         keys: ['Ctrl', 'K'] },
              { action: 'Send query',                keys: ['⏎ Enter'] },
              { action: 'New line in input',         keys: ['Shift', '⏎'] },
              { action: 'Dismiss / clear input',     keys: ['Esc'] },
              { action: 'Copy last SQL',             keys: ['Ctrl', 'Shift', 'C'] },
            ].map(({ action, keys }) => (
              <div key={action} className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{action}</span>
                <div className="flex items-center gap-1">
                  {keys.map((k, i) => (
                    <span key={i}
                      className="px-2 py-0.5 bg-muted border border-border rounded-md text-xs font-mono text-foreground">
                      {k}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Connection health */}
        <Section title="Connection Health">
          <div className="px-5 py-4 rounded-2xl bg-card border border-border"
            style={{ boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <TestTube2 className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Test Connection</p>
                  <p className="text-xs text-muted-foreground">Verify the database is reachable right now</p>
                </div>
              </div>
              <button
                onClick={handleTest}
                disabled={testing}
                className="px-4 py-2 bg-primary text-white rounded-xl text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {testing ? 'Testing…' : 'Test Now'}
              </button>
            </div>
            {testResult && (
              <div className={`mt-3 px-4 py-3 rounded-xl text-xs font-medium flex items-center gap-2 ${
                testResult.success
                  ? 'bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20'
                  : 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20'
              }`}>
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                {testResult.success ? 'Connection successful' : testResult.message ?? 'Connection failed'}
              </div>
            )}
          </div>

          <SettingCard
            icon={Trash2}
            iconColor="text-muted-foreground"
            iconBg="bg-muted"
            title="Clear Session Cache"
            description="Remove cached credentials and connection state stored in this browser"
            subtle
            right={
              <button
                onClick={handleClearSession}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  sessionCleared
                    ? 'bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400'
                    : 'bg-muted border-border text-muted-foreground hover:text-foreground hover:border-border/80'
                }`}
              >
                {sessionCleared ? '✓ Cleared' : 'Clear'}
              </button>
            }
          />
        </Section>

        {/* Danger zone */}
        <Section title="Danger Zone">
          <div className="px-5 py-4 rounded-2xl bg-destructive/5 border border-destructive/20 space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0">
                  <ShieldAlert className="w-5 h-5 text-destructive" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Delete Connection</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Permanently remove this connection and all its chats, schemas, and history
                  </p>
                </div>
              </div>
              {confirmDelete ? (
                <div className="flex items-center gap-2 ml-4 shrink-0">
                  <span className="text-xs text-destructive font-medium">Permanently delete?</span>
                  <button
                    onClick={async () => {
                      if (!org) return;
                      try {
                        await connectionApi.delete(org.id, connId);
                        router.push(`/orgs/${slug}/connections`);
                      } catch (e) { console.error(e); setConfirmDelete(false); }
                    }}
                    className="flex items-center gap-1 px-3 py-1.5 bg-destructive text-white rounded-lg text-xs font-semibold hover:opacity-90 transition-opacity"
                  >
                    <Check className="w-3.5 h-3.5" /> Yes, delete
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-muted border border-border text-muted-foreground rounded-lg text-xs font-semibold hover:text-foreground transition-colors"
                  >
                    <X className="w-3.5 h-3.5" /> Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="px-4 py-2 bg-destructive/10 border border-destructive/30 text-destructive rounded-xl text-xs font-semibold hover:bg-destructive/20 transition-colors shrink-0 ml-4"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        </Section>

        {/* Bottom spacer */}
        <div className="h-8" />
      </div>
    </div>
  );
}
