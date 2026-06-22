'use client';

import { useCallback } from 'react';

// Light haptic feedback for key touch actions. `navigator.vibrate` is
// Android-only — iOS Safari/PWA ignores it — so this degrades to a silent
// no-op there. Never throws: some browsers reject vibrate() outside a user
// gesture, which we swallow.
type HapticPattern = 'tap' | 'success' | 'warning';

const PATTERNS: Record<HapticPattern, number | number[]> = {
  tap: 8,
  success: [10, 35, 10],
  warning: 22,
};

export function useHaptics() {
  return useCallback((pattern: HapticPattern = 'tap') => {
    if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
    try {
      navigator.vibrate(PATTERNS[pattern]);
    } catch {
      /* ignore — vibrate can throw without a user gesture */
    }
  }, []);
}
