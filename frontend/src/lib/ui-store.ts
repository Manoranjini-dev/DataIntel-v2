// ── UI Store (in-memory) ─────────────────────────────────────────
// Cross-component UI state, e.g. whether the global left navigation
// sidebar is collapsed. Used by the dashboard editor to auto-collapse
// the sidebar when entering edit mode (giving the canvas more room),
// and by the Sidebar component to render its collapsed/expanded form.

import { create } from 'zustand';

interface UIStore {
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarCollapsed: false,
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}));
