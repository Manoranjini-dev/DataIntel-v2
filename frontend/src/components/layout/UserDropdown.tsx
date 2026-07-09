'use client';

import { useState } from 'react';
import { useAuthStore } from '@/lib/auth-store';
import { authApi } from '@/lib/api';
import { LogOut, User } from 'lucide-react';
import { SignOutConfirmationModal } from './SignOutConfirmationModal';

export function UserDropdown() {
  const { user, clearUser } = useAuthStore();
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);

  const handleLogout = async () => {
    try { await authApi.logout(); } catch { /* ignore network errors */ }
    clearUser();
    window.location.replace('/');
  };

  if (!user) return null;

  const rawName = user.displayName?.trim() || user.email?.trim();
  const userInitial = rawName ? rawName[0].toUpperCase() : null;

  return (
    <>
      <div className="flex items-center space-x-3">
        <div
          className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-white shadow-sm"
          style={{ background: 'linear-gradient(135deg,#D97A1E,#F5A623)' }}
          title={user.displayName || user.email}
        >
          {userInitial ? userInitial : <User className="w-4 h-4 text-white shrink-0" />}
        </div>
        <div className="text-sm">
          <p className="font-medium">{user.displayName || user.email}</p>
          <p className="text-muted-foreground text-xs">{user.email}</p>
        </div>
        <button 
          onClick={() => setShowSignOutConfirm(true)}
          className="p-2 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title="Log out"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </div>

      <SignOutConfirmationModal
        isOpen={showSignOutConfirm}
        onClose={() => setShowSignOutConfirm(false)}
        onConfirm={handleLogout}
      />
    </>
  );
}
