'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { LayoutDashboard, CreditCard, Database, Layers, Settings } from 'lucide-react';
import { useOrgStore } from '../../store/org';
import { useAuthStore } from '@/lib/auth-store';

// C1X logo — from image file
function C1XLogo({ size = 32 }: { size?: number }) {
  return (
    <img
      src="/image.png"
      alt="C1X Logo"
      style={{ height: size, width: 'auto', objectFit: 'contain' }}
    />
  );
}

const NAV_ITEMS = [
  { href: 'dashboards', icon: LayoutDashboard, label: 'Dashboard' },
  { href: 'cards', icon: CreditCard, label: 'Cards' },
  { href: 'connections', icon: Database, label: 'Data Sources' },
  { href: 'combos', icon: Layers, label: 'Combos' },
  { href: 'settings', icon: Settings, label: 'Settings' },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const { slug } = useParams<{ slug?: string }>();
  const { currentOrgId } = useOrgStore();
  const { user } = useAuthStore();

  const activeSlug = slug || currentOrgId;
  if (!activeSlug) return null;

  return (
    <aside
      className="flex flex-col shrink-0 h-full bg-card border-r border-border"
      style={{ width: 220 }}
    >
      {/* Brand */}
      <div className="px-5 pt-6 pb-5">
        <Link href={`/orgs/${activeSlug}/dashboards`}>
          <C1XLogo size={32} />
        </Link>
      </div>

      <div className="mx-4 h-px bg-border mb-3" />

      {/* Primary nav */}
      <nav className="flex-1 px-3 space-y-0.5">
        {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
          const fullHref = `/orgs/${activeSlug}/${href}`;
          const active = pathname.startsWith(fullHref);
          return (
            <Link
              key={href}
              href={fullHref}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all
                ${active
                  ? 'bg-[#2B2B2B] text-white shadow-sm'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'}
              `}
            >
              <Icon className={`w-[18px] h-[18px] shrink-0 ${active ? 'text-[#F5A623]' : ''}`} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* User chip */}
      <div className="mx-3 mb-4 p-3 rounded-xl bg-muted/60 border border-border flex items-center gap-2.5">
        <div
          className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-white"
          style={{ background: 'linear-gradient(135deg,#D97A1E,#F5A623)' }}
        >
          {user?.displayName?.[0]?.toUpperCase() ?? 'U'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-foreground truncate leading-tight">{user?.displayName ?? 'User'}</p>
          <p className="text-[10px] text-muted-foreground truncate">{user?.email ?? ''}</p>
        </div>
      </div>
    </aside>
  );
}
