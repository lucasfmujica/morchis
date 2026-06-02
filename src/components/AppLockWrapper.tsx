'use client';

import { usePinStore } from '@/store/pinStore';
import { PinLockScreen } from '@/components/PinLockScreen';

export function AppLockWrapper({ children }: { children: React.ReactNode }) {
  const { pin, locked } = usePinStore();

  if (locked && pin !== null) {
    return <PinLockScreen />;
  }

  return <>{children}</>;
}
