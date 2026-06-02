import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface PrivacyStore {
  hideAmounts: boolean;
  toggle: () => void;
}

// Bank-style "ojito" — hides every monetary value on screen. Persisted so the
// preference survives reloads.
export const usePrivacyStore = create<PrivacyStore>()(
  persist(
    (set) => ({
      hideAmounts: false,
      toggle: () => set((s) => ({ hideAmounts: !s.hideAmounts })),
    }),
    { name: 'morchis-privacy' },
  ),
);
