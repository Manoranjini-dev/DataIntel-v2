'use client';

import { usePrefsStore } from '@/lib/prefs-store';
import { Zap, Eye, BarChart3, Database, Lock } from 'lucide-react';

// ── Toggle Row ────────────────────────────────────────────────────
function Toggle({ label, description, checked, onChange, disabled, lockedReason }: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  lockedReason?: string;
}) {
  return (
    <div className={`flex items-center justify-between gap-4 py-3.5 border-b border-border/50 last:border-0 ${disabled ? 'opacity-70' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-foreground">{label}</p>
          {disabled && lockedReason && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-primary/70 bg-primary/8 px-1.5 py-0.5 rounded-md border border-primary/20">
              <Lock className="w-2.5 h-2.5" /> Required
            </span>
          )}
        </div>
        {lockedReason && disabled ? (
          <p className="text-xs text-primary/60 mt-0.5 leading-relaxed">{lockedReason}</p>
        ) : description ? (
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 ${
          disabled ? 'cursor-not-allowed' : 'cursor-pointer'
        } ${checked ? 'bg-primary' : 'bg-border'}`}
      >
        <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`} />
      </button>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────
export default function SettingsPage() {
  // triggered update
  // Preferences from in-memory Zustand store (no localStorage)
  const { autoExecute, showGeneratedSQL, streamResults, rowLimit,
    showQueryExplanations, includeSchemaHints, enableDashboards,
    autoSaveLayout, compactMessages, updatePref } = usePrefsStore();

  const cardCls = 'bg-card border border-border rounded-2xl p-6';
  const sectionHeadCls = 'flex items-center gap-2.5 mb-4';

  return (
    <div className="flex-1 p-8 overflow-auto animate-fade-in">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Settings</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage your query, display, and dashboard preferences
          </p>
        </div>

        <div className="space-y-5 animate-fade-in">

          {/* Info banner — no persistence */}
          <div className="px-4 py-3 rounded-xl bg-muted/60 border border-border text-muted-foreground text-xs flex items-start gap-2.5 leading-relaxed">
            <span className="mt-0.5 shrink-0 text-base">💡</span>
            <span>Preferences are session-only and reset when you reload. Changes take effect immediately in the chat.</span>
          </div>

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
              description="Automatically run AI-generated SQL. When off, you review and can edit the SQL before it runs."
              checked={autoExecute}
              onChange={v => updatePref('autoExecute', v)}
            />
            <Toggle
              label="Stream results"
              description="Stream query results progressively as they arrive instead of waiting for all rows"
              checked={streamResults}
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
                      rowLimit === n
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
              checked={includeSchemaHints}
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

            {/* showGeneratedSQL — locked ON when autoExecute is off */}
            <Toggle
              label="Show generated SQL"
              description="Display the SQL query generated by the AI alongside each result"
              checked={autoExecute ? showGeneratedSQL : true}
              onChange={v => updatePref('showGeneratedSQL', v)}
              disabled={!autoExecute}
              lockedReason="Always shown when auto-execute is off — you need to see the SQL to edit it before running"
            />
            <Toggle
              label="Show query explanations"
              description="Include AI-generated plain-English explanations of what each query does"
              checked={showQueryExplanations}
              onChange={v => updatePref('showQueryExplanations', v)}
            />
            <Toggle
              label="Compact message view"
              description="Use a denser layout for chat messages to see more on screen"
              checked={compactMessages}
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
              description="Allow creating and viewing dashboards"
              checked={enableDashboards}
              onChange={v => updatePref('enableDashboards', v)}
            />
            <Toggle
              label="Auto-save widget layouts"
              description="Automatically save dashboard layout changes as you drag and resize widgets"
              checked={autoSaveLayout}
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

        <div className="h-8" />
      </div>
    </div>
  );
}
