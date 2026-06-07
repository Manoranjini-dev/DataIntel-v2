'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

// ── Toggle Component ───────────────────────────────────────────
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${checked ? 'bg-violet-600' : 'bg-white/10 border border-white/20'}`}
    >
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}

// ── SettingRow Component ───────────────────────────────────────
function SettingRow({ icon, title, desc, right }: { icon: string; title: string; desc: string; right: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between p-4 bg-[#14141e] rounded-xl border border-white/[0.06] hover:border-white/[0.10] transition-colors group">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-sm flex-shrink-0">{icon}</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white">{title}</p>
          <p className="text-xs text-zinc-500 mt-0.5">{desc}</p>
        </div>
      </div>
      <div className="flex-shrink-0 ml-4">{right}</div>
    </div>
  );
}

// ── Section ────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-widest mb-3">{title}</p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

export default function ConnectionSettingsPage() {
  const { slug, connId } = useParams<{ slug: string; connId: string }>();

  // Settings state — stored locally (can be synced to backend later)
  const [showGeneratedQuery, setShowGeneratedQuery] = useState(false);
  const [autoApprove, setAutoApprove] = useState(false);
  const [enableDashboard, setEnableDashboard] = useState(true);
  const [rowLimit, setRowLimit] = useState<100 | 250 | 500>(500);
  const [sessionCleared, setSessionCleared] = useState(false);

  function handleClearSession() {
    // Clear any local storage or cookies specific to this connection
    if (typeof window !== 'undefined') {
      const keysToRemove = Object.keys(localStorage).filter(k => k.includes(connId));
      keysToRemove.forEach(k => localStorage.removeItem(k));
    }
    setSessionCleared(true);
    setTimeout(() => setSessionCleared(false), 3000);
  }

  return (
    <div className="h-screen bg-[#0a0a0f] text-white flex overflow-hidden">
      {/* Left sidebar */}
      <aside className="w-44 border-r border-white/[0.08] flex flex-col h-full bg-[#0c0c14] flex-shrink-0">
        <div className="px-3 py-3 border-b border-white/[0.06] flex-shrink-0">
          <Link href={`/orgs/${slug}/connections/${connId}`}
            className="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
            Back
          </Link>
        </div>
        <nav className="py-2 flex-1">
          {[
            { href: `/orgs/${slug}/connections/${connId}/dashboard`, icon: '📊', label: 'Dashboard' },
            { href: `/orgs/${slug}/connections/${connId}/chat`, icon: '💬', label: 'Chat' },
            { href: `/orgs/${slug}/connections/${connId}/schema`, icon: '📋', label: 'Schema' },
            { href: `/orgs/${slug}/connections/${connId}/settings`, icon: '⚙️', label: 'Settings', active: true },
          ].map(item => (
            <Link key={item.href} href={item.href}
              className={`flex items-center gap-2.5 mx-2 px-2.5 py-2 rounded-lg text-xs mb-0.5 transition-all ${(item as any).active ? 'bg-violet-500/15 border border-violet-500/20 text-violet-300' : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'}`}>
              <span>{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {/* Header */}
        <div className="border-b border-white/[0.08] px-8 py-5 bg-[#0c0c14]">
          <div className="flex items-center gap-3 mb-0.5">
            <Link href={`/orgs/${slug}/connections/${connId}`} className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors flex items-center gap-1">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
              Back
            </Link>
            <span className="text-zinc-700">/</span>
            <h1 className="text-base font-semibold text-white">Settings</h1>
          </div>
          <p className="text-sm text-zinc-500">Configure your connection preferences and display settings</p>
        </div>

        <div className="px-8 py-6 max-w-2xl space-y-8">
          {/* Query Display */}
          <Section title="Query Display">
            <SettingRow
              icon="<>"
              title="Show Generated Query"
              desc="Display the generated SQL or FS DSL alongside results"
              right={<Toggle checked={showGeneratedQuery} onChange={setShowGeneratedQuery} />}
            />
            <SettingRow
              icon="🛡️"
              title="Auto-Approve Query Execution"
              desc="Automatically run validated queries without waiting for manual approval"
              right={<Toggle checked={autoApprove} onChange={setAutoApprove} />}
            />
          </Section>

          {/* Dashboard */}
          <Section title="Dashboard">
            <SettingRow
              icon="📊"
              title="Enable Dashboard"
              desc="Show the dashboard page for drag-and-drop analytics widgets"
              right={<Toggle checked={enableDashboard} onChange={setEnableDashboard} />}
            />
          </Section>

          {/* Result Limit */}
          <Section title="Result Limit">
            <div className="flex items-center justify-between p-4 bg-[#14141e] rounded-xl border border-white/[0.06]">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-sm flex-shrink-0">📏</div>
                <div>
                  <p className="text-sm font-medium text-white">Max rows per query</p>
                  <p className="text-xs text-zinc-500 mt-0.5">LIMIT injected into every generated query</p>
                </div>
              </div>
              <div className="flex gap-1.5 flex-shrink-0 ml-4">
                {([100, 250, 500] as const).map(n => (
                  <button key={n} onClick={() => setRowLimit(n)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${rowLimit === n ? 'bg-violet-600/30 border-violet-500/50 text-violet-300' : 'bg-white/5 border-white/10 text-zinc-400 hover:bg-white/10 hover:text-zinc-200'}`}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </Section>

          {/* Keyboard Shortcuts */}
          <Section title="Keyboard Shortcuts">
            <div className="p-4 bg-[#14141e] rounded-xl border border-white/[0.06] space-y-2.5">
              {[
                { action: 'Focus chat input', keys: ['Ctrl', 'K'] },
                { action: 'Send query', keys: ['Enter'] },
                { action: 'Show keyboard shortcuts', keys: ['?'] },
                { action: 'Dismiss modal / clear input', keys: ['Esc'] },
              ].map(({ action, keys }) => (
                <div key={action} className="flex items-center justify-between">
                  <span className="text-sm text-zinc-400">{action}</span>
                  <div className="flex items-center gap-1">
                    {keys.map((k, i) => (
                      <span key={i} className="px-2 py-0.5 bg-white/10 border border-white/20 rounded text-xs font-mono text-zinc-300">{k}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* Session */}
          <Section title="Session">
            <div className="flex items-center justify-between p-4 bg-[#14141e] rounded-xl border border-white/[0.06]">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-sm flex-shrink-0">🗑️</div>
                <div>
                  <p className="text-sm font-medium text-white">Clear Saved Session</p>
                  <p className="text-xs text-zinc-500 mt-0.5">Remove stored credentials and disconnect</p>
                </div>
              </div>
              <button onClick={handleClearSession}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all flex-shrink-0 ml-4 ${sessionCleared ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-white/5 border-white/10 text-zinc-400 hover:bg-white/10 hover:text-zinc-200'}`}>
                {sessionCleared ? (
                  <><span>✓</span> Cleared</>
                ) : (
                  <><span>↺</span> Reset</>
                )}
              </button>
            </div>

            {/* Test connection */}
            <div className="flex items-center justify-between p-4 bg-[#14141e] rounded-xl border border-white/[0.06]">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-sm flex-shrink-0">⚡</div>
                <div>
                  <p className="text-sm font-medium text-white">Test Connection</p>
                  <p className="text-xs text-zinc-500 mt-0.5">Verify that the database connection is still active</p>
                </div>
              </div>
              <Link href={`/orgs/${slug}/connections/${connId}`}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200 transition-all flex-shrink-0 ml-4">
                Test Now
              </Link>
            </div>
          </Section>

          {/* Danger zone */}
          <Section title="Danger Zone">
            <div className="p-4 bg-red-500/5 border border-red-500/20 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center text-sm flex-shrink-0">🗑️</div>
                  <div>
                    <p className="text-sm font-medium text-white">Delete Connection</p>
                    <p className="text-xs text-zinc-500 mt-0.5">Permanently remove this connection and all its chats</p>
                  </div>
                </div>
                <button className="px-3 py-1.5 bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 rounded-lg text-xs font-medium transition-colors flex-shrink-0 ml-4">
                  Delete
                </button>
              </div>
            </div>
          </Section>
        </div>
      </main>
    </div>
  );
}
