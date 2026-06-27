'use client';

import { useAuthStore } from '@/lib/auth-store';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { LogOut, User } from 'lucide-react';

export function UserDropdown() {
  const { user, clearUser } = useAuthStore();

  const handleLogout = () => {
    clearUser();
    window.location.href = '/login';
  };

  if (!user) return null;

  return (
    <div className="flex items-center space-x-4">
      <div className="text-sm">
        <p className="font-medium">{user.displayName}</p>
        <p className="text-muted-foreground text-xs">{user.email}</p>
      </div>
      <button 
        onClick={handleLogout}
        className="p-2 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        title="Log out"
      >
        <LogOut className="w-5 h-5" />
      </button>
    </div>
  );
}
