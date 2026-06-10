import { create } from 'zustand';
import { persist } from 'zustand/middleware';

async function sha256Hex(raw: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(raw));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface PinState {
  pin: string | null;
  locked: boolean;
  setPin: (raw: string | null) => void;
  lock: () => void;
  unlock: () => void;
}

export const usePinStore = create<PinState>()(
  persist(
    (set) => ({
      pin: null,
      locked: false,
      setPin: async (raw: string | null) => {
        if (raw === null) {
          set({ pin: null, locked: false });
        } else {
          const hash = await sha256Hex(raw);
          set({ pin: hash, locked: false });
        }
      },
      lock: () => set({ locked: true }),
      unlock: () => set({ locked: false }),
    }),
    {
      name: 'morchis-pin',
      // Don't persist `locked` — a stale persisted `false` would keep the app
      // unlocked forever. Instead, start locked on every load when a PIN is set.
      partialize: (state) => ({ pin: state.pin }),
      onRehydrateStorage: () => (state) => {
        if (state?.pin) state.lock();
      },
    },
  ),
);

export { sha256Hex };
