// ── Preferences Store (in-memory, no persistence) ────────────────
// Preferences reset on page reload — intentional (no caching).
// Shared across all components via Zustand.

import { create } from 'zustand';

export interface AppPrefs {
  autoExecute: boolean;
  showGeneratedSQL: boolean;
  streamResults: boolean;
  rowLimit: 100 | 250 | 500;
  showQueryExplanations: boolean;
  includeSchemaHints: boolean;
  enableDashboards: boolean;
  autoSaveLayout: boolean;
  compactMessages: boolean;
}

interface PrefsStore extends AppPrefs {
  updatePref: <K extends keyof AppPrefs>(key: K, value: AppPrefs[K]) => void;
  resetPrefs: () => void;
}

const DEFAULT_PREFS: AppPrefs = {
  autoExecute: true,
  showGeneratedSQL: true,
  streamResults: false,
  rowLimit: 250,
  showQueryExplanations: true,
  includeSchemaHints: true,
  enableDashboards: true,
  autoSaveLayout: true,
  compactMessages: false,
};

export const usePrefsStore = create<PrefsStore>((set) => ({
  ...DEFAULT_PREFS,
  updatePref: (key, value) =>
    set((state) => {
      const next = { ...state, [key]: value };
      // When autoExecute is turned off, force showGeneratedSQL on
      if (key === 'autoExecute' && value === false) {
        next.showGeneratedSQL = true;
      }
      return next;
    }),
  resetPrefs: () => set({ ...DEFAULT_PREFS }),
}));
