// Shared money math for the snapshot-aware edge functions (ask-morchis,
// monthly-close). NO imports → runs identically on Deno and under Node/Vitest.
//
// "Snapshot-aware": a USD amount is converted at its frozen per-tx rate
// (usd_rate_snapshot) when present, else the latest blue rate. NOTE: budget-alert
// deliberately uses a different model (current rate only, rounded) for live
// envelope availability, so it keeps its own toArs/share — do not fold it here.

export const toArs = (a: number, cur: string, snap: number | null, blue: number) =>
  cur === 'USD' ? a * (Number(snap) || blue) : a;

export interface SplitLike { payer_profile_id: string; ower_profile_id: string; amount: number }
export interface ShareTx { profile_id: string; is_shared: boolean; amount: number; currency: string; usd_rate_snapshot?: number | null; splits?: SplitLike[] | null }

// A person's own share of a (possibly shared) expense, in ARS — BEFORE any
// friend-debt netting. This is the single source of truth that both
// ask-morchis (shareForExpense / lensFraction) and monthly-close (spentForBudget)
// build on, so the split rule can never drift between them.
//  - not shared        → full amount if it's theirs, else 0
//  - shared, they owe   → their ower split
//  - shared, they paid  → total minus what others owe them
//  - shared, neither    → full if it's their own tx, else 0
export function personalShareArs(t: ShareTx, profileId: string, blue: number): number {
  const total = toArs(t.amount, t.currency, t.usd_rate_snapshot ?? null, blue);
  if (!t.is_shared) return t.profile_id === profileId ? total : 0;
  const sp = t.splits ?? [];
  const iOwe = sp.filter(s => s.ower_profile_id === profileId).reduce((a, s) => a + s.amount, 0);
  if (iOwe > 0) return iOwe;
  const owedToMe = sp.filter(s => s.payer_profile_id === profileId).reduce((a, s) => a + s.amount, 0);
  if (owedToMe > 0) return Math.max(0, total - owedToMe);
  return t.profile_id === profileId ? total : 0;
}
