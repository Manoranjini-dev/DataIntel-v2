'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { orgApi } from '@/lib/api';
import { Hash, AlertTriangle, Zap, Eye, BarChart3, Database } from 'lucide-react';

// ── Local-storage key per org ────────────────────────────────
function prefsKey(slug: string) { return `di_prefs_${slug}`; }

interface OrgPrefs {
  autoExecute: boolean;
  showGeneratedSQL: boolean;
  streamResults: boolean;
  rowLimit: 100 | 250 | 500;
  showQueryExplanations: boolean;
  includeSchemaHints: boolean;
  enableDashboards: boolean;
  autoSaveLayout: boolean;
  compactMessages: boolean;
}

const DEFAULT_PREFS: OrgPrefs = {
  autoExecute: true,
  showGeneratedSQL: true,
  streamResults: false,
  rowLimit: 250,
  showQueryExplanations: true,
  includeSchemaHints: true,
  enableDashboards: true,
  autoSaveLayout: true,
  compactMessages: false,
};

function loadPrefs(slug: string): OrgPrefs {
  try {
    const raw = localStorage.getItem(prefsKey(slug));
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_PREFS };
}

function savePrefs(slug: string, prefs: OrgPrefs) {
  try { localStorage.setItem(prefsKey(slug), JSON.stringify(prefs)); } catch {}
}

// ── Toggle Row ────────────────────────────────────────────────
function Toggle({ label, description, checked, onChange }: {
  label: string; description?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5 border-b border-border/50 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 ${
          checked ? 'bg-primary' : 'bg-border'
        }`}
      >
        <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4.5' : 'translate-x-0.5'
        }`} />
      </button>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────
export default function OrgSettingsPage() {
  const { slug } = useParams<{ slug: string }>();
  const [org, setOrg] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [activeSection, setActiveSection] = useState<'general' | 'preferences' | 'danger'>('general');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [prefs, setPrefs] = useState<OrgPrefs>(DEFAULT_PREFS);
  const [prefsSaved, setPrefsSaved] = useState(false);

  useEffect(() => { loadData(); }, [slug]);
  useEffect(() => {
    if (slug) setPrefs(loadPrefs(slug));
  }, [slug]);

  async function loadData() {
    try {
      const { org: o } = await orgApi.get(slug);
      setOrg(o);
      setName(o.name || '');
      setDescription(o.description || '');
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!org) return;
    setSaving(true);
    try {
      await orgApi.update?.(org.id, { name, description });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      await loadData();
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  }

  function updatePref<K extends keyof OrgPrefs>(key: K, value: OrgPrefs[K]) {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    savePrefs(slug, next);
    setPrefsSaved(true);
    setTimeout(() => setPrefsSaved(false), 2000);
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const inputCls = 'w-full px-3 py-2.5 bg-muted/50 border border-border rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all';
  const cardCls = 'bg-card border border-border rounded-2xl p-6';
  const sectionHeadCls = 'flex items-center gap-2.5 mb-4';

  return (
    <div className="flex-1 p-8 overflow-auto animate-fade-in">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Organization Settings</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage configuration for <span className="text-foreground font-medium">{org?.name}</span>
          </p>
        </div>

        {/* Pill nav */}
        <div className="pill-nav w-fit">
          {(['general', 'preferences', 'danger'] as const).map(tab => (
            <button
              key={tab}
              className={`pill-nav-item ${activeSection === tab ? 'active' : ''} ${tab === 'danger' && activeSection === 'danger' ? 'text-destructive' : ''}`}
              onClick={() => setActiveSection(tab)}
            >
              {tab === 'general' ? 'General' : tab === 'preferences' ? 'Preferences' : 'Danger Zone'}
            </button>
          ))}
        </div>

        {/* ── General ────────────────────────────────────────── */}
        {activeSection === 'general' && (
          <div className="space-y-5 animate-fade-in">
            {saveSuccess && (
              <div className="px-4 py-3 rounded-xl bg-success/10 border border-success/20 text-success text-sm flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-success" />
                Settings saved successfully
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-5">
              <div className={cardCls} style={{ boxShadow: 'var(--shadow-soft)' }}>
                <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-5">Identity</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">Organization Name</label>
                    <input value={name} onChange={e => setName(e.target.value)} required className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                      Description <span className="text-muted-foreground/50">(optional)</span>
                    </label>
                    <textarea
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      rows={3}
                      placeholder="Describe your organization..."
                      className={`${inputCls} resize-none`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">Organization Slug</label>
                    <div className="px-3 py-2.5 bg-muted/30 border border-border/50 rounded-xl text-sm text-muted-foreground font-mono flex items-center gap-2">
                      <Hash className="w-3.5 h-3.5" />
                      {org?.slug}
                    </div>
                    <p className="text-xs text-muted-foreground/50 mt-1">Slug cannot be changed after creation</p>
                  </div>
                </div>
              </div>

              {/* Org info */}
              <div className={cardCls} style={{ boxShadow: 'var(--shadow-soft)' }}>
                <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-4">Organization Info</h2>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Organization ID', value: org?.id },
                    { label: 'Your Role',        value: org?.member_role },
                    { label: 'Created',          value: org?.created_at ? new Date(org.created_at).toLocaleDateString() : '—' },
                    { label: 'Plan',             value: org?.plan || 'Free' },
                  ].map(({ label, value }) => (
                    <div key={label} className="p-3 bg-muted/30 rounded-xl">
                      <p className="text-xs text-muted-foreground mb-1">{label}</p>
                      <p className="text-sm text-foreground font-mono truncate">{value || '—'}</p>
                    </div>
                  ))}
                </div>
              </div>

              <button type="submit" disabled={saving || !name.trim()}
                className="px-6 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40">
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </form>
          </div>
        )}

        {/* ── Preferences ─────────────────────────────────────── */}
        {activeSection === 'preferences' && (
          <div className="space-y-5 animate-fade-in">

            {prefsSaved && (
              <div className="px-4 py-3 rounded-xl bg-success/10 border border-success/20 text-success text-sm flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-success" />
                Preferences saved
              </div>
            )}

            {/* Query Execution */}
            <div className={cardCls} style={{ boxShadow: 'var(--shadow-soft)' }}>
              <div className={sectionHeadCls}>
                <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Zap className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Query Execution</h2>
                  <p className="text-xs text-muted-foreground">How AI-generated queries run</p>
                </div>
              </div>

              <Toggle
                label="Auto-execute queries"
                description="Automatically run AI-generated SQL without a manual confirmation step"
                checked={prefs.autoExecute}
                onChange={v => updatePref('autoExecute', v)}
              />
              <Toggle
                label="Stream results"
                description="Stream query results progressively as they arrive instead of waiting for all rows"
                checked={prefs.streamResults}
                onChange={v => updatePref('streamResults', v)}
              />
              <div className="py-3.5 border-b border-border/50">
                <p className="text-sm font-medium text-foreground mb-2">Default row limit</p>
                <p className="text-xs text-muted-foreground mb-3">Maximum rows returned per query</p>
                <div className="flex gap-2">
                  {([100, 250, 500] as const).map(n => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => updatePref('rowLimit', n)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                        prefs.rowLimit === n
                          ? 'bg-primary/10 border-primary/40 text-primary'
                          : 'bg-muted/50 border-border text-muted-foreground hover:border-primary/20'
                      }`}
                    >
                      {n} rows
                    </button>
                  ))}
                </div>
              </div>
              <Toggle
                label="Include schema hints"
                description="Send table/column context to the AI for more accurate query generation"
                checked={prefs.includeSchemaHints}
                onChange={v => updatePref('includeSchemaHints', v)}
              />
            </div>

            {/* Display */}
            <div className={cardCls} style={{ boxShadow: 'var(--shadow-soft)' }}>
              <div className={sectionHeadCls}>
                <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center">
                  <Eye className="w-4 h-4 text-accent" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Display</h2>
                  <p className="text-xs text-muted-foreground">Chat and results appearance</p>
                </div>
              </div>

              <Toggle
                label="Show generated SQL"
                description="Display the SQL query generated by the AI alongside each result"
                checked={prefs.showGeneratedSQL}
                onChange={v => updatePref('showGeneratedSQL', v)}
              />
              <Toggle
                label="Show query explanations"
                description="Include AI-generated plain-English explanations of what each query does"
                checked={prefs.showQueryExplanations}
                onChange={v => updatePref('showQueryExplanations', v)}
              />
              <Toggle
                label="Compact message view"
                description="Use a denser layout for chat messages to see more on screen"
                checked={prefs.compactMessages}
                onChange={v => updatePref('compactMessages', v)}
              />
            </div>

            {/* Dashboards */}
            <div className={cardCls} style={{ boxShadow: 'var(--shadow-soft)' }}>
              <div className={sectionHeadCls}>
                <div className="w-7 h-7 rounded-lg bg-success/10 flex items-center justify-center">
                  <BarChart3 className="w-4 h-4 text-success" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Dashboards</h2>
                  <p className="text-xs text-muted-foreground">Widget and layout settings</p>
                </div>
              </div>

              <Toggle
                label="Enable dashboards"
                description="Allow creating and viewing dashboards for this organization"
                checked={prefs.enableDashboards}
                onChange={v => updatePref('enableDashboards', v)}
              />
              <Toggle
                label="Auto-save widget layouts"
                description="Automatically save dashboard layout changes as you drag and resize widgets"
                checked={prefs.autoSaveLayout}
                onChange={v => updatePref('autoSaveLayout', v)}
              />
            </div>

            {/* Keyboard shortcuts */}
            <div className={cardCls} style={{ boxShadow: 'var(--shadow-soft)' }}>
              <div className={sectionHeadCls}>
                <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center">
                  <Database className="w-4 h-4 text-muted-foreground" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Keyboard Shortcuts</h2>
                  <p className="text-xs text-muted-foreground">Reference for power users</p>
                </div>
              </div>
              <div className="space-y-2 mt-2">
                {[
                  { key: 'Enter', action: 'Send message' },
                  { key: 'Shift + Enter', action: 'New line in message' },
                  { key: 'Ctrl + K', action: 'New chat' },
                  { key: 'Ctrl + /', action: 'Toggle SQL view' },
                  { key: 'Esc', action: 'Cancel / close' },
                ].map(({ key, action }) => (
                  <div key={key} className="flex items-center justify-between py-2 border-b border-border/40 last:border-0">
                    <span className="text-sm text-muted-foreground">{action}</span>
                    <kbd className="px-2.5 py-1 bg-muted border border-border rounded-lg text-xs font-mono text-foreground">
                      {key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}

        {/* ── Danger Zone ──────────────────────────────────────── */}
        {activeSection === 'danger' && (
          <div className="space-y-5 animate-fade-in">
            <div className="bg-destructive/5 border border-destructive/20 rounded-2xl p-6">
              <div className="flex items-start gap-3 mb-5">
                <div className="w-9 h-9 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5 text-destructive" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-destructive">Delete Organization</h2>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Permanently delete this organization and all its data — connections, chats, dashboards, and members.
                    This action <strong className="text-foreground">cannot be undone</strong>.
                  </p>
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    Type <code className="font-mono text-foreground bg-muted px-1.5 py-0.5 rounded text-xs">{org?.slug}</code> to confirm
                  </label>
                  <input
                    value={deleteConfirm}
                    onChange={e => setDeleteConfirm(e.target.value)}
                    placeholder={org?.slug}
                    className="w-full px-3 py-2.5 bg-muted/50 border border-destructive/20 rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-destructive/30"
                  />
                </div>
                <button
                  disabled={deleteConfirm !== org?.slug}
                  onClick={() => alert('Delete functionality — confirm backend API before enabling')}
                  className="px-5 py-2.5 bg-destructive/10 border border-destructive/30 text-destructive rounded-xl text-sm font-semibold transition-colors disabled:opacity-30 hover:bg-destructive/20"
                >
                  Delete Organization
                </button>
              </div>
            </div>

            <div className="bg-warning/5 border border-warning/20 rounded-2xl p-6">
              <h2 className="text-sm font-semibold text-yellow-600 dark:text-yellow-400 mb-1">Leave Organization</h2>
              <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
                Remove yourself from this organization. You will lose access to all its resources.
              </p>
              <button className="px-5 py-2.5 bg-yellow-500/10 border border-yellow-500/20 text-yellow-600 dark:text-yellow-400 rounded-xl text-sm font-semibold transition-colors hover:bg-yellow-500/20">
                Leave Organization
              </button>
            </div>
          </div>
        )}

        <div className="h-8" />
      </div>
    </div>
  );
}
