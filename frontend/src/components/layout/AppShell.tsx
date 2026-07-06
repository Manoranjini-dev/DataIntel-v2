'use client';

import { useEffect, useState } from 'react';
import { Sidebar } from './Sidebar';
import { useAuthStore } from '@/lib/auth-store';
import { usePathname } from 'next/navigation';
import { authApi } from '@/lib/api';

const PUBLIC_ROUTES = ['/', '/login', '/register', '/activate', '/forgot-password', '/reset-password', '/embed'];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, setUser, clearUser } = useAuthStore();
  const pathname = usePathname();
  const isPublicRoute = PUBLIC_ROUTES.some(r => pathname === r || pathname.startsWith(r + '/'));

  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    // Always verify the session with the server on mount.
    // This ensures the Zustand store stays in sync after SSO redirects,
    // where the cookie changes but the local state may be stale.
    authApi.me()
      .then(res => {
        if (res.success && res.account) {
          setUser(res.account);
        } else {
          clearUser();
        }
      })
      .catch((err) => {
        // Network/backend down — keep local auth state so the app doesn't flash
        // a login redirect when the backend is briefly unreachable.
        console.warn('[AppShell] auth check failed (network/backend down?), keeping local auth state.', err);
      })
      .finally(() => setIsChecking(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isChecking) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isPublicRoute) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <Sidebar />

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Page content */}
        <main className="flex-1 overflow-auto bg-background">
          {children}
        </main>
      </div>
    </div>
  );
}
