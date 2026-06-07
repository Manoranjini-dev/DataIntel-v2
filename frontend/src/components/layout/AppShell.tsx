'use client';

import { Sidebar } from './Sidebar';
import { UserDropdown } from './UserDropdown';
import { useAuthStore } from '@/lib/auth-store';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();

  if (!isAuthenticated) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <div className="border-r border-border bg-sidebar shrink-0" style={{ boxShadow: '1px 0 0 hsl(var(--border))' }}>
        <Sidebar />
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top header */}
        <header className="h-12 border-b border-border bg-background/95 backdrop-blur-md flex items-center justify-end px-6 shrink-0 sticky top-0 z-10" style={{ boxShadow: 'var(--shadow-soft)' }}>
          <UserDropdown />
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto bg-background">
          {children}
        </main>
      </div>
    </div>
  );
}
