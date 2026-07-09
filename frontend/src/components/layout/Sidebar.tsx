'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, CreditCard, Database, Layers, Settings, Users, ShieldCheck, PanelLeftClose, PanelLeftOpen, LogOut, User } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { useUIStore } from '@/lib/ui-store';
import { authApi } from '@/lib/api';
import { SignOutConfirmationModal } from './SignOutConfirmationModal';

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
  { href: '/dashboards',  icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/cards',       icon: CreditCard,      label: 'Cards' },
  { href: '/connections', icon: Database,        label: 'Data Sources' },
  { href: '/combos',      icon: Layers,          label: 'Combos' },
  { href: '/settings',    icon: Settings,        label: 'Settings' },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, clearUser } = useAuthStore();
  const { sidebarCollapsed, toggleSidebar } = useUIStore();
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);

  const isAdmin = user?.role === 'ADMIN';
  const adminActive = pathname.startsWith('/admin/users') || pathname.startsWith('/admin/sso');

  const rawName = user?.displayName?.trim() || user?.email?.trim();
  const userInitial = rawName ? rawName[0].toUpperCase() : null;

  const handleSignOut = async () => {
    // Always clear local state and navigate — even if the backend is unreachable.
    // The backend logout endpoint is @Public() so it never 401s.
    try { await authApi.logout(); } catch { /* ignore network errors */ }
    clearUser();
    // Use a full page reload to clear all in-memory React state cleanly.
    window.location.replace('/');
  };

  // ── Collapsed: thin icon-only rail with an expand button ──────────
  if (sidebarCollapsed) {
    return (
      <aside
        className="flex flex-col items-center shrink-0 h-full bg-card border-r border-border py-4 gap-1"
        style={{ width: 56 }}
      >
        {/* Expand toggle */}
        <button
          onClick={toggleSidebar}
          title="Expand sidebar"
          className="w-9 h-9 rounded-xl flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-all mb-2"
        >
          <PanelLeftOpen className="w-[18px] h-[18px]" />
        </button>

        <div className="w-7 h-px bg-border mb-2" />

        {/* Icon-only nav */}
        <nav className="flex-1 flex flex-col items-center gap-1">
          {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                title={label}
                className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
                  active
                    ? 'bg-[#2B2B2B] text-white shadow-sm'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <Icon className={`w-[18px] h-[18px] shrink-0 ${active ? 'text-[#F5A623]' : ''}`} />
              </Link>
            );
          })}
          {isAdmin && (
            <>
              <Link
                href="/admin/users"
                title="User Management"
                className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
                  pathname.startsWith('/admin/users') ? 'bg-[#2B2B2B] text-white shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <Users className={`w-[18px] h-[18px] shrink-0 ${pathname.startsWith('/admin/users') ? 'text-[#F5A623]' : ''}`} />
              </Link>
              <Link
                href="/admin/sso"
                title="SSO Settings"
                className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
                  pathname.startsWith('/admin/sso') ? 'bg-[#2B2B2B] text-white shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <ShieldCheck className={`w-[18px] h-[18px] shrink-0 ${pathname.startsWith('/admin/sso') ? 'text-[#F5A623]' : ''}`} />
              </Link>
            </>
          )}
        </nav>

        {/* User avatar & Logout */}
        <div className="mt-auto flex flex-col items-center gap-2 mb-4">
          <button
            onClick={() => setShowSignOutConfirm(true)}
            title="Sign out"
            className="w-9 h-9 rounded-xl flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-destructive transition-all"
          >
            <LogOut className="w-[18px] h-[18px]" />
          </button>
          <div
            className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-white shadow-sm"
            style={{ background: 'linear-gradient(135deg,#D97A1E,#F5A623)' }}
            title={user?.displayName || user?.email || 'User'}
          >
            {userInitial ? userInitial : <User className="w-4 h-4 text-white shrink-0" />}
          </div>
        </div>

        <SignOutConfirmationModal
          isOpen={showSignOutConfirm}
          onClose={() => setShowSignOutConfirm(false)}
          onConfirm={handleSignOut}
        />
      </aside>
    );
  }

  // ── Expanded: full sidebar ───────────────────────────────────────
  return (
    <aside
      className="flex flex-col shrink-0 h-full bg-card border-r border-border"
      style={{ width: 220 }}
    >
      {/* Brand + collapse button */}
      <div className="px-5 pt-6 pb-5 flex items-center justify-between">
        <Link href="/dashboards">
          <C1XLogo size={32} />
        </Link>
        <button
          onClick={toggleSidebar}
          title="Collapse sidebar"
          className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
        >
          <PanelLeftClose className="w-[18px] h-[18px]" />
        </button>
      </div>

      <div className="mx-4 h-px bg-border mb-3" />

      {/* Primary nav */}
      <nav className="flex-1 px-3 space-y-0.5">
        {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
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

        {isAdmin && (
          <>
            <div className="mx-1 my-2 h-px bg-border" />
            <Link
              href="/admin/users"
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all
                ${pathname.startsWith('/admin/users')
                  ? 'bg-[#2B2B2B] text-white shadow-sm'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'}
              `}
            >
              <Users className={`w-[18px] h-[18px] shrink-0 ${pathname.startsWith('/admin/users') ? 'text-[#F5A623]' : ''}`} />
              User Management
            </Link>
            <Link
              href="/admin/sso"
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all
                ${pathname.startsWith('/admin/sso')
                  ? 'bg-[#2B2B2B] text-white shadow-sm'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'}
              `}
            >
              <ShieldCheck className={`w-[18px] h-[18px] shrink-0 ${pathname.startsWith('/admin/sso') ? 'text-[#F5A623]' : ''}`} />
              SSO Settings
            </Link>
          </>
        )}
      </nav>

      {/* User chip */}
      <div className="mx-3 mb-4 p-3 rounded-xl bg-muted/60 border border-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-white shadow-sm"
            style={{ background: 'linear-gradient(135deg,#D97A1E,#F5A623)' }}
          >
            {userInitial ? userInitial : <User className="w-4 h-4 text-white shrink-0" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-foreground truncate leading-tight">{user?.displayName || user?.email || 'User'}</p>
            <p className="text-[10px] text-muted-foreground truncate">{user?.email ?? ''}</p>
          </div>
        </div>
        <button
          onClick={() => setShowSignOutConfirm(true)}
          title="Sign out"
          className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-muted rounded-md transition-colors shrink-0"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>

      <SignOutConfirmationModal
        isOpen={showSignOutConfirm}
        onClose={() => setShowSignOutConfirm(false)}
        onConfirm={handleSignOut}
      />
    </aside>
  );
}
