import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface CurrencyStore {
  showUSD: boolean;
  toggle: () => void;
}

export const useCurrencyStore = create<CurrencyStore>()(
  persist(
    (set) => ({
      showUSD: false,
      toggle: () => set((s) => ({ showUSD: !s.showUSD })),
    }),
    { name: 'morchis-currency' },
  ),
);
