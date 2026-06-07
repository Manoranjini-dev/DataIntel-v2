import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface OrgState {
  currentOrgId: string | null;
  setCurrentOrgId: (orgId: string) => void;
  clearOrg: () => void;
}

export const useOrgStore = create<OrgState>()(
  persist(
    (set) => ({
      currentOrgId: null,
      setCurrentOrgId: (orgId) => set({ currentOrgId: orgId }),
      clearOrg: () => set({ currentOrgId: null }),
    }),
    {
      name: 'org-storage',
    }
  )
);
