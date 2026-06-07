// ──────────────────────────────────────────────
// Auth Store — Client-side session state (Zustand)
// ──────────────────────────────────────────────

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Account {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
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
