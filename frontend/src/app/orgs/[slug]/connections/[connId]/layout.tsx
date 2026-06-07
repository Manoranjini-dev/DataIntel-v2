'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { ArrowLeft, Home, MessageSquare, LayoutDashboard, Table2, GitFork } from 'lucide-react';

const TABS = [
  { key: '',          label: 'Overview',   icon: Home          },
  { key: 'chat',      label: 'Chat',       icon: MessageSquare  },
  { key: 'dashboard', label: 'Dashboard',  icon: LayoutDashboard},
  { key: 'schema',    label: 'Schema',     icon: Table2         },
  { key: 'erd',       label: 'ERD',        icon: GitFork        },
] as const;

export default function ConnectionLayout({ children }: { children: React.ReactNode }) {
  const { slug, connId } = useParams<{ slug: string; connId: string }>();
  const pathname  = usePathname();
  const base      = `/orgs/${slug}/connections/${connId}`;

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* ── Connection sub-nav ───────────────────────────── */}
      <nav
        className="shrink-0 h-11 border-b border-border bg-card flex items-center px-4 gap-0.5"
        style={{ boxShadow: 'var(--shadow-soft)' }}
      >
        {/* Back */}
        <Link
          href={`/orgs/${slug}/connections`}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all mr-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Data Sources
        </Link>

        <div className="w-px h-4 bg-border mr-2" />

        {/* Tabs */}
        {TABS.map(({ key, label, icon: Icon }) => {
          const href   = key ? `${base}/${key}` : base;
          const active = key
            ? pathname.startsWith(`${base}/${key}`)
            : pathname === base || pathname === `${base}/`;

          return (
            <Link
              key={key}
              href={href}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                active
                  ? 'bg-[#2B2B2B] text-white'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-[#F5A623]' : ''}`} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* ── Page content ─────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {children}
      </div>

    </div>
  );
}
