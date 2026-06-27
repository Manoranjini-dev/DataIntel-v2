'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { connectionApi } from '@/lib/api';
import {
  Code2, Zap, BarChart3, Rows3, Keyboard, Trash2, Radio,
  TestTube2, Database, ShieldAlert, CheckCircle2, RefreshCw,
} from 'lucide-react';

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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  // Access level for the current user on this connection ('owner' | 'edit' | 'view')
  const accessLevel: 'owner' | 'edit' | 'view' | null = conn?.access_level ?? null;
  const isOwner = accessLevel === 'owner';
  const canEdit = isOwner || accessLevel === 'edit';

  // Sharing
  const [shares, setShares] = useState<any[]>([]);
  const [shareEmail, setShareEmail] = useState('');
  const [shareLevel, setShareLevel] = useState<'view' | 'edit'>('view');
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  // Auto refresh
  const [refreshSchedule, setRefreshSchedule] = useState<any>(null);
  const [refreshInterval, setRefreshInterval] = useState(60);
  const [savingRefresh, setSavingRefresh] = useState(false);
  const [triggering, setTriggering] = useState(false);

  useEffect(() => { loadData(); }, [connId]);

  async function loadData() {
    try {
      const { connection } = await connectionApi.get(connId);
      setConn(connection);
      setEditName(connection?.name ?? '');
      setEditDescription(connection?.description ?? '');

      const { schedule } = await connectionApi.getRefreshSchedule(connId);
      setRefreshSchedule(schedule);
      if (schedule?.refresh_interval_minutes) setRefreshInterval(schedule.refresh_interval_minutes);

      if (connection?.access_level === 'owner') {
        const { shares: s } = await connectionApi.listShares(connId);
        setShares(s);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function handleShare(e: React.FormEvent) {
    e.preventDefault();
    setSharing(true);
    setShareError(null);
    try {
      await connectionApi.share(connId, { email: shareEmail, accessLevel: shareLevel });
      setShareEmail('');
      const { shares: s } = await connectionApi.listShares(connId);
      setShares(s);
    } catch (e: any) {
      setShareError(e?.message || 'Failed to share connection');
    } finally { setSharing(false); }
  }

  async function handleRevoke(accountId: string) {
    try {
      await connectionApi.revokeShare(connId, accountId);
      setShares(s => s.filter((x: any) => x.account_id !== accountId));
    } catch (e) { console.error(e); }
  }

  async function handleSaveRefresh(enabled: boolean, intervalMinutes?: number) {
    setSavingRefresh(true);
    try {
      const { schedule } = await connectionApi.setRefreshSchedule(connId, { enabled, intervalMinutes });
      setRefreshSchedule(schedule);
    } catch (e) { console.error(e); }
    finally { setSavingRefresh(false); }
  }

  async function handleTriggerRefresh() {
    setTriggering(true);
    try {
      await connectionApi.triggerRefresh(connId);
      const { schedule } = await connectionApi.getRefreshSchedule(connId);
      setRefreshSchedule(schedule);
    } catch (e) { console.error(e); }
    finally { setTriggering(false); }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await connectionApi.test(connId);
      setTestResult({ success: result.success, message: result.success ? 'Connection successful' : 'Connection failed' });
    } catch (e: any) {
      setTestResult({ success: false, message: e?.message ?? 'Connection failed' });
    } finally { setTesting(false); }
  }

  async function handleSaveCredentials(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await connectionApi.update(connId, { name: editName, description: editDescription });
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
                {canEdit && (
                  <button
                    onClick={() => setEditMode(true)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/80 text-foreground font-medium transition-colors border border-border"
                  >
                    Edit
                  </button>
                )}
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

        {/* Sharing — owner (or Admin) only; shared users never see this */}
        {isOwner && (
          <Section title="Sharing" subtitle="Manage who else can access this connection">
            <div className="px-5 py-4 rounded-2xl bg-card border border-border space-y-4"
              style={{ boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}>
              <form onSubmit={handleShare} className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Share with (email)</label>
                  <input
                    type="email" required value={shareEmail} onChange={e => setShareEmail(e.target.value)}
                    placeholder="teammate@company.com"
                    className="w-full px-3 py-2 bg-muted/50 border border-border rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
                <select value={shareLevel} onChange={e => setShareLevel(e.target.value as 'view' | 'edit')}
                  className="px-3 py-2 bg-muted/50 border border-border rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40">
                  <option value="view">Read</option>
                  <option value="edit">Edit</option>
                </select>
                <button type="submit" disabled={sharing || !shareEmail.trim()}
                  className="px-4 py-2 bg-primary text-white rounded-xl text-xs font-semibold disabled:opacity-50 hover:opacity-90 transition-opacity">
                  {sharing ? 'Sharing…' : 'Share'}
                </button>
              </form>
              {shareError && <p className="text-xs text-destructive">{shareError}</p>}

              <div className="space-y-2 pt-3 border-t border-border">
                {shares.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Not shared with anyone yet.</p>
                ) : shares.map((s: any) => (
                  <div key={s.account_id} className="flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="text-sm text-foreground truncate">{s.display_name || s.email}</p>
                      <p className="text-xs text-muted-foreground truncate">{s.email} · {s.can_edit ? 'Edit' : 'Read'}</p>
                    </div>
                    <button
                      onClick={() => handleRevoke(s.account_id)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-muted hover:bg-destructive/10 hover:text-destructive text-muted-foreground font-medium transition-colors border border-border shrink-0 ml-3"
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </Section>
        )}

        {/* Auto Refresh — status visible to anyone with access; configuration is owner-only */}
        {accessLevel && (
          <Section title="Auto Refresh" subtitle="Keep the schema in sync with the live data source on a schedule">
            <div className="px-5 py-4 rounded-2xl bg-card border border-border space-y-4"
              style={{ boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}>
              {isOwner ? (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Enable Auto Refresh</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Automatically re-sync the schema on an interval</p>
                    </div>
                    <Toggle
                      checked={!!refreshSchedule?.refresh_enabled}
                      onChange={(v) => handleSaveRefresh(v, refreshInterval)}
                    />
                  </div>
                  {refreshSchedule?.refresh_enabled && (
                    <div className="flex flex-wrap gap-1.5">
                      {REFRESH_INTERVALS.map(opt => (
                        <button key={opt.value}
                          onClick={() => { setRefreshInterval(opt.value); handleSaveRefresh(true, opt.value); }}
                          disabled={savingRefresh}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-50 ${
                            refreshInterval === opt.value
                              ? 'bg-primary text-white shadow-sm'
                              : 'bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground border border-border'
                          }`}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {refreshSchedule?.refresh_enabled
                    ? `Auto-refresh is enabled (${(REFRESH_INTERVALS.find(o => o.value === refreshSchedule.refresh_interval_minutes)?.label ?? `every ${refreshSchedule.refresh_interval_minutes}m`).toLowerCase()})`
                    : 'Auto-refresh is disabled for this connection.'}
                </p>
              )}

              <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border text-xs">
                <div>
                  <p className="text-muted-foreground">Last Refresh</p>
                  <p className="text-foreground font-medium mt-0.5">
                    {refreshSchedule?.last_refresh_at ? new Date(refreshSchedule.last_refresh_at).toLocaleString() : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Next Refresh</p>
                  <p className="text-foreground font-medium mt-0.5">
                    {refreshSchedule?.next_refresh_at ? new Date(refreshSchedule.next_refresh_at).toLocaleString() : '—'}
                  </p>
                </div>
              </div>

              {refreshSchedule?.last_refresh_status && (
                <p className={`text-xs font-medium ${refreshSchedule.last_refresh_status === 'success' ? 'text-green-600' : 'text-destructive'}`}>
                  Last run: {refreshSchedule.last_refresh_status === 'success' ? 'Succeeded' : `Failed — ${refreshSchedule.last_refresh_error || 'unknown error'}`}
                </p>
              )}

              {canEdit && (
                <button onClick={handleTriggerRefresh} disabled={triggering}
                  className="px-4 py-2 bg-muted hover:bg-muted/80 border border-border rounded-xl text-xs font-semibold text-foreground disabled:opacity-50 transition-colors">
                  {triggering ? 'Refreshing…' : 'Refresh Now'}
                </button>
              )}
            </div>
          </Section>
        )}

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

        {/* Danger zone — owner (or Admin) only; never shown to a shared user */}
        {isOwner && (
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
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="px-4 py-2 bg-destructive/10 border border-destructive/30 text-destructive rounded-xl text-xs font-semibold hover:bg-destructive/20 transition-colors shrink-0 ml-4"
                >
                  Delete
                </button>
              </div>
            </div>
          </Section>
        )}

        {/* Delete connection confirmation */}
        {confirmDelete && (
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => !deleting && setConfirmDelete(false)}
          >
            <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-xl p-6" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0">
                  <ShieldAlert className="w-5 h-5 text-destructive" />
                </div>
                <h2 className="text-base font-semibold text-foreground">Delete Connection?</h2>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed mb-6">
                This action will permanently delete the data source connection and all related
                dashboards, chats, history, and generated artifacts. This action cannot be undone.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    setDeleting(true);
                    try {
                      await connectionApi.delete(connId);
                      router.push(`/connections`);
                    } catch (e) { console.error(e); setDeleting(false); setConfirmDelete(false); }
                  }}
                  disabled={deleting}
                  className="flex-1 py-2.5 bg-destructive hover:opacity-90 text-white rounded-xl text-sm font-semibold disabled:opacity-40 transition-opacity"
                >
                  {deleting ? 'Deleting…' : 'Yes, delete connection'}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  disabled={deleting}
                  className="px-5 py-2.5 bg-muted hover:bg-muted/80 rounded-xl text-sm text-muted-foreground transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Bottom spacer */}
        <div className="h-8" />
      </div>
    </div>
  );
}
