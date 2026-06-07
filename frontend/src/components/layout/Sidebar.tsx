'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import {
  Home,
  LayoutDashboard,
  MessageSquare,
  Database,
  Settings,
  Users,
  Shield,
  Layers,
  CreditCard,
  ChevronRight,
  Zap,
} from 'lucide-react';
import { useOrgStore } from '../../store/org';
import { useAuthStore } from '@/lib/auth-store';

export function Sidebar() {
  const pathname = usePathname();
  const { slug, connId } = useParams<{ slug: string; connId?: string }>();
  const { currentOrgId } = useOrgStore();
  const { user } = useAuthStore();
  const activeSlug = slug || currentOrgId;

  if (!activeSlug) return null;

  const orgLinks = [
    { href: `/orgs/${activeSlug}`,             icon: Home,          label: 'Overview' },
    { href: `/orgs/${activeSlug}/connections`,  icon: Database,      label: 'Connections' },
    { href: `/orgs/${activeSlug}/combos`,       icon: Layers,        label: 'Combos' },
    { href: `/orgs/${activeSlug}/chats`,        icon: MessageSquare, label: 'Chats' },
    { href: `/orgs/${activeSlug}/dashboards`,   icon: LayoutDashboard, label: 'Dashboards' },
    { href: `/orgs/${activeSlug}/cards`,        icon: CreditCard,    label: 'Cards' },
    { href: `/orgs/${activeSlug}/members`,      icon: Users,         label: 'Members' },
    { href: `/orgs/${activeSlug}/audit`,        icon: Shield,        label: 'Audit Logs' },
    { href: `/orgs/${activeSlug}/settings`,     icon: Settings,      label: 'Settings' },
  ];

  const connectionLinks = connId ? [
    { href: `/orgs/${activeSlug}/connections/${connId}`,           label: 'Overview' },
    { href: `/orgs/${activeSlug}/connections/${connId}/chat`,      label: 'Chat' },
    { href: `/orgs/${activeSlug}/connections/${connId}/dashboard`, label: 'Dashboards' },
    { href: `/orgs/${activeSlug}/connections/${connId}/schema`,    label: 'Schema' },
    { href: `/orgs/${activeSlug}/connections/${connId}/erd`,       label: 'ERD' },
  ] : [];

  return (
    <aside
      className="flex flex-col shrink-0 overflow-y-auto"
      style={{ width: '280px' }}
    >
      {/* Logo / Brand */}
      <div className="px-5 pt-6 pb-4 shrink-0">
        <Link href={`/orgs/${activeSlug}`} className="flex items-center gap-3 group">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105"
            style={{ background: 'linear-gradient(135deg, #D97A1E, #F5A623)' }}
          >
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="font-bold text-sm text-foreground leading-none">DataIntel</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 truncate max-w-[160px]">
              {user?.displayName ?? activeSlug}
            </p>
          </div>
        </Link>
      </div>

      {/* Divider */}
      <div className="mx-5 h-px bg-border mb-3" />

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-0.5 pb-4">
        {orgLinks.map((link) => {
          const Icon = link.icon;
          const isConnectionSection = link.label === 'Connections';
          const isActive = link.href === `/orgs/${activeSlug}`
            ? pathname === link.href
            : pathname.startsWith(link.href);
          const isConnectionActive = isConnectionSection && pathname.startsWith(`/orgs/${activeSlug}/connections`);
          const active = isActive || isConnectionActive;

          return (
            <div key={link.href}>
              <Link
                href={link.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 group ${
                  active
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                }`}
              >
                <Icon className={`w-[18px] h-[18px] shrink-0 ${active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}`} />
                <span className="flex-1">{link.label}</span>
                {isConnectionSection && connId && (
                  <ChevronRight className="w-3.5 h-3.5 opacity-50 rotate-90" />
                )}
              </Link>

              {/* Connection sub-navigation */}
              {isConnectionActive && connId && (
                <div className="mt-1 mb-2 ml-5 pl-4 border-l-2 border-primary/20 space-y-0.5">
                  {connectionLinks.map((sublink) => {
                    const isSubActive = sublink.href.endsWith(connId)
                      ? pathname === sublink.href
                      : pathname.startsWith(sublink.href);
                    return (
                      <Link
                        key={sublink.href}
                        href={sublink.href}
                        className={`block px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 ${
                          isSubActive
                            ? 'text-primary bg-primary/10'
                            : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                        }`}
                      >
                        {sublink.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Bottom user area */}
      <div className="mx-3 mb-4 p-3 rounded-xl bg-muted/50 border border-border/50 flex items-center gap-3">
        <div
          className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-white"
          style={{ background: 'linear-gradient(135deg, #D97A1E, #F5A623)' }}
        >
          {user?.displayName?.[0]?.toUpperCase() ?? 'U'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground truncate">{user?.displayName ?? 'User'}</p>
          <p className="text-[11px] text-muted-foreground truncate">{user?.email ?? ''}</p>
        </div>
      </div>
    </aside>
  );
}
