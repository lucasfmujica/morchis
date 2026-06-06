// Shared budget math so the home and the budgets page agree on how much a
// person "spent" against a budget — especially for shared expenses, where each
// person should only be charged their own part (via the split), no matter who
// actually fronted the money.

export interface BudgetRow {
  id: string;
  category_id: string;
  scope: string;
  amount: number;
  currency?: string | null;
  profile_id?: string | null;
}

export interface SplitRow {
  payer_profile_id: string;
  ower_profile_id: string;
  amount: number;
}

export interface BudgetExpenseRow {
  category_id: string | null;
  amount: number;
  currency: string;
  scope: string;
  profile_id: string;
  is_shared: boolean;
  occurred_on?: string;
  splits?: SplitRow[] | null;
}

export function toArs(amount: number, currency: string | null | undefined, arsPerUsd: number): number {
  return currency === 'USD' && arsPerUsd > 0 ? Math.round(amount * arsPerUsd) : amount;
}

/**
 * How much of an expense counts as `profileId`'s own spend, in ARS.
 * Splits are stored in ARS and record what the ower owes the payer.
 * - Not shared → the whole amount.
 * - Shared & I owe a part → just my part.
 * - Shared & others owe me (I paid) → total minus what they owe me.
 * - Shared with no split info → mine only if I'm the one who paid.
 */
export function myShareArs(t: BudgetExpenseRow, profileId: string, arsPerUsd: number): number {
  const total = toArs(t.amount, t.currency, arsPerUsd);
  if (!t.is_shared) return total;
  const splits = t.splits ?? [];
  const iOwe = splits.filter((s) => s.ower_profile_id === profileId).reduce((a, s) => a + s.amount, 0);
  if (iOwe > 0) return iOwe;
  const owedToMe = splits.filter((s) => s.payer_profile_id === profileId).reduce((a, s) => a + s.amount, 0);
  if (owedToMe > 0) return Math.max(0, total - owedToMe);
  return t.profile_id === profileId ? total : 0;
}

/**
 * Spend (ARS) counted against a budget for the current month's expense rows.
 * - Personal budget → the owner's own spend in the category: their solo
 *   expenses in full, their share of shared ones (whoever paid), and any
 *   household expense they personally fronted — the full amount when it wasn't
 *   divided, their part when it was.
 * - Household budget → the full amount of household-scoped expenses (the
 *   couple's combined spend in that category).
 */
export function spentForBudget(
  b: BudgetRow,
  rows: BudgetExpenseRow[],
  viewerProfileId: string,
  arsPerUsd: number,
): number {
  const owner = b.profile_id ?? viewerProfileId;
  return rows
    .filter((t) => t.category_id === b.category_id)
    .reduce((sum, t) => {
      if (b.scope === 'household') {
        return t.scope === 'household' ? sum + toArs(t.amount, t.currency, arsPerUsd) : sum;
      }
      if (t.is_shared) return sum + myShareArs(t, owner, arsPerUsd);
      // Non-shared: it's the owner's spend when they fronted it — whether a solo
      // personal expense or a household one they paid without dividing.
      return t.profile_id === owner
        ? sum + toArs(t.amount, t.currency, arsPerUsd)
        : sum;
    }, 0);
}

/** SQL column list for fetching expense rows compatible with the helpers above. */
export const BUDGET_EXPENSE_SELECT =
  'category_id, amount, currency, scope, profile_id, is_shared, occurred_on, splits(payer_profile_id, ower_profile_id, amount)';
