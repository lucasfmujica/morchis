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
  // Optional display fields, only needed when listing the rows behind a total.
  id?: string;
  merchant?: string | null;
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
  return rows.reduce((sum, t) => sum + budgetContribution(b, t, viewerProfileId, arsPerUsd), 0);
}

/**
 * How much a single expense row contributes to a budget's spend (ARS), using
 * the same rules as `spentForBudget`. Returns 0 when the row doesn't count
 * (wrong category, not the owner's spend, or a personal share of 0). Listing
 * the rows with a non-zero contribution reproduces the budget's total exactly.
 */
export function budgetContribution(
  b: BudgetRow,
  t: BudgetExpenseRow,
  viewerProfileId: string,
  arsPerUsd: number,
): number {
  if (t.category_id !== b.category_id) return 0;
  const owner = b.profile_id ?? viewerProfileId;
  if (b.scope === 'household') {
    return t.scope === 'household' ? toArs(t.amount, t.currency, arsPerUsd) : 0;
  }
  if (t.is_shared) return myShareArs(t, owner, arsPerUsd);
  // Non-shared: it's the owner's spend when they fronted it — whether a solo
  // personal expense or a household one they paid without dividing.
  return t.profile_id === owner ? toArs(t.amount, t.currency, arsPerUsd) : 0;
}

/**
 * How much a single expense row contributes to the "this week" total for a tab,
 * mirroring the budgets page header. On the Nuestro tab it's the full amount of
 * household-scoped rows; on Personal it's the viewer's own share.
 */
export function weekContribution(
  t: BudgetExpenseRow,
  tab: 'personal' | 'household',
  viewerProfileId: string,
  arsPerUsd: number,
): number {
  if (tab === 'household') {
    return t.scope === 'household' ? toArs(t.amount, t.currency, arsPerUsd) : 0;
  }
  if (t.is_shared) return myShareArs(t, viewerProfileId, arsPerUsd);
  return t.profile_id === viewerProfileId ? toArs(t.amount, t.currency, arsPerUsd) : 0;
}

/** SQL column list for fetching expense rows compatible with the helpers above. */
export const BUDGET_EXPENSE_SELECT =
  'category_id, amount, currency, scope, profile_id, is_shared, occurred_on, splits(payer_profile_id, ower_profile_id, amount)';
