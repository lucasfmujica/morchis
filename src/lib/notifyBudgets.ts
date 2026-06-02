import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Fire-and-forget trigger for the `budget-alert` edge function, which sends a
 * web push if a budget just crossed 80% / 100%. Called right after saving a
 * transaction (the saver is online, so it can also reach the partner whose
 * shared-expense budget moved). Never throws — push is best-effort.
 */
export function triggerBudgetAlerts(supabase: SupabaseClient): void {
  try {
    void supabase.functions.invoke('budget-alert').catch(() => {});
  } catch {
    /* ignore */
  }
}
