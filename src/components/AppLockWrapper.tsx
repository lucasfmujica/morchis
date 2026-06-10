'use client';

import { useEffect } from 'react';
import { usePinStore } from '@/store/pinStore';
import { PinLockScreen } from '@/components/PinLockScreen';

export function AppLockWrapper({ children }: { children: React.ReactNode }) {
  const { pin, locked, lock } = usePinStore();

  // Re-lock whenever the app goes to the background (tab switch, app switch
  // on mobile). Cosmetic privacy gate only — not real security.
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden' && usePinStore.getState().pin) {
        lock();
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [lock]);

  if (locked && pin !== null) {
    return <PinLockScreen />;
  }

  return <>{children}</>;
}
