// ──────────────────────────────────────────────
// Auth Store — Client-side session state (Zustand)
// ──────────────────────────────────────────────

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type PlatformRole = 'ADMIN' | 'ANALYST' | 'VIEWER';
export type UserStatus = 'PENDING_INVITATION' | 'ACTIVE' | 'INACTIVE' | 'DELETED';

export interface Account {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: PlatformRole;
  status: UserStatus;
  isActive: boolean;
  emailVerified: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface AuthState {
  user: Account | null;
  isAuthenticated: boolean;
  setUser: (user: Account) => void;
  clearUser: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      setUser: (user) => set({ user, isAuthenticated: true }),
      clearUser: () => set({ user: null, isAuthenticated: false }),
    }),
    {
      name: 'dataintel-auth',
      partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
    },
  ),
);
