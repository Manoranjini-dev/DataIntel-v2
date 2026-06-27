'use client';

import { Sidebar } from './Sidebar';
import { useAuthStore } from '@/lib/auth-store';
import { usePathname } from 'next/navigation';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  const pathname = usePathname();

  if (!isAuthenticated || pathname === '/') {
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
