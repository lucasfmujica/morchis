'use client';

import { useEffect } from 'react';
import { useNotifStore } from '@/store/notifStore';

export interface BudgetAlertItem {
  id: string;
  /** Category label shown in the notification. */
  name: string;
  /** spent / limit (0..n). */
  pct: number;
}

const STORE_KEY = 'morchis-budget-alert-levels';

// Notify once when a budget first crosses 80%, and again when it crosses 100%.
// We remember the last level we notified per budget (in localStorage) so the
// same threshold never fires twice, and a new month (spend back to 0) re-arms it.
function levelFor(pct: number): 0 | 80 | 100 {
  if (pct >= 1) return 100;
  if (pct >= 0.8) return 80;
  return 0;
}

/**
 * Fires a local notification when a budget reaches 80% / 100%.
 * Local (service-worker) notification, so it shows while the PWA is open with
 * permission granted — no backend push needed.
 */
export function useBudgetAlerts(items: BudgetAlertItem[]): void {
  const enabled = useNotifStore((s) => s.budget_overspend);
  // Stable signature so the effect only re-runs when a level actually changes.
  const signature = items.map((i) => `${i.id}:${levelFor(i.pct)}`).join('|');

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    let levels: Record<string, number> = {};
    try {
      levels = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    } catch {
      levels = {};
    }

    const toNotify: BudgetAlertItem[] = [];
    let changed = false;
    for (const it of items) {
      const level = levelFor(it.pct);
      const prev = levels[it.id] ?? 0;
      if (level > prev) toNotify.push(it);
      if (level !== prev) {
        levels[it.id] = level;
        changed = true;
      }
    }

    if (changed) {
      // Drop budgets that no longer exist so the store doesn't grow forever.
      const live = new Set(items.map((i) => i.id));
      for (const id of Object.keys(levels)) if (!live.has(id)) delete levels[id];
      localStorage.setItem(STORE_KEY, JSON.stringify(levels));
    }

    if (toNotify.length === 0) return;
    navigator.serviceWorker?.ready
      .then((reg) => {
        for (const it of toNotify) {
          const over = it.pct >= 1;
          reg.showNotification(over ? '🚨 Presupuesto excedido' : '⚠️ Cerca del límite', {
            body: over
              ? `Te pasaste del presupuesto de ${it.name}.`
              : `Vas por el ${Math.round(it.pct * 100)}% del presupuesto de ${it.name}.`,
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-192.png',
            tag: `budget-${it.id}`,
          });
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, enabled]);
}
