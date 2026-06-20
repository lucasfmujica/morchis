// YNAB-style envelope budgeting math — INDIVIDUAL per person.
//
// Each person assigns their own money to their own category "envelopes" each
// month. The numbers shown are:
//   assigned   — what you put in the envelope this month (budget_months.assigned)
//   activity   — what actually left the envelope this month (YOUR net share of
//                expenses in that category, after couple-splits and friend-debt
//                reimbursements — never the full amount someone else owes you)
//   available  — assigned − activity, ACCUMULATED from the first month forward
//                (positive carries over; negative carries over as a debt)
//   Para asignar (Ready to Assign) — your on-budget cash that isn't yet sitting
//                in any envelope: onBudgetCash − Σ(available across your envelopes)
//
// Reimbursements (you fronted, someone owes you): your envelope only drops by
// YOUR share, but your cash dropped by the whole amount, so the receivable
// naturally depresses your "Para asignar" until you're paid back — no separate
// "Por cobrar" envelope. The repayment must land as on-budget cash to restore it.
//
// Credit cards (full YNAB model): a card purchase moves your share OUT of the
// spending envelope and INTO that card's "Pago <card>" envelope (so its
// available rises by what you'll owe). Paying the statement (a transfer into the
// credit account) drains the payment envelope back down. Credit balances are not
// counted as assignable cash; the payment envelope stands in for the liability.
//
// All amounts are ARS internally. We reuse the couple-split share math from
// budgets.ts so envelope activity agrees with the rest of the app.

import { toArs, myShareArs, type BudgetExpenseRow } from '@/lib/budgets';
import { assetBalance, type AccountTx } from '@/lib/accounts';

/** Account row needed for on-budget cash + credit-card payment mapping. */
export interface EnvelopeAccount {
  id: string;
  type: string;
  currency: string;
  archived: boolean;
  initial_balance: number;
  owner_profile_id?: string | null;
  on_budget: boolean;
  payment_category_id?: string | null;
}

/** A transaction row used to derive envelope activity (expense or transfer). */
export interface EnvelopeTx extends BudgetExpenseRow {
  id: string;
  type: string; // 'expense' | 'income' | 'transfer'
  occurred_on: string; // 'YYYY-MM-DD' (required here)
  account_id?: string | null;
  transfer_account_id?: string | null;
}

/** A monthly assignment (one budget_months row). */
export interface Assignment {
  category_id: string;
  month: string; // 'YYYY-MM'
  assigned: number;
  currency?: string | null;
}

/** Per-category figures for a single month (all ARS). */
export interface EnvelopeRow {
  categoryId: string;
  assigned: number; // assigned this month
  activity: number; // net activity this month (spend positive, inflows negative)
  available: number; // cumulative carryover through this month
}

const keyOf = (categoryId: string, month: string) => `${categoryId}__${month}`;
const monthOf = (iso: string) => iso.slice(0, 7);

/**
 * Your on-budget cash in ARS as of `asOfISO`: the balance of the cash/checking
 * accounts you own that are marked on_budget. Credit cards are excluded (their
 * liability is represented by the payment envelope), as are off-budget/tracking
 * accounts (e.g. savings) and archived accounts.
 */
export function onBudgetCashArs(
  accounts: EnvelopeAccount[],
  tx: AccountTx[],
  profileId: string,
  asOfISO: string,
  arsPerUsd: number,
): number {
  let total = 0;
  for (const a of accounts) {
    if (a.archived || !a.on_budget || a.type === 'credit') continue;
    if (a.owner_profile_id !== profileId) continue;
    const bal = assetBalance(tx, a.id, a.initial_balance ?? 0, asOfISO);
    total += a.currency === 'USD' && arsPerUsd > 0 ? bal * arsPerUsd : bal;
  }
  return Math.round(total);
}

/**
 * Your net share of a single expense in ARS, mirroring the personal-budget rule
 * in budgets.ts: shared → your split share; solo → the full amount only if you
 * fronted it. A linked friend reimbursement (`receivableArs`) is netted out,
 * because the part a friend owes you was never your spend.
 */
export function expenseShareArs(
  t: EnvelopeTx,
  profileId: string,
  arsPerUsd: number,
  receivableArs = 0,
): number {
  const gross = t.is_shared
    ? myShareArs(t, profileId, arsPerUsd)
    : t.profile_id === profileId
      ? toArs(t.amount, t.currency, arsPerUsd)
      : 0;
  return Math.max(0, gross - receivableArs);
}

/**
 * Net activity per (category, month) in ARS for one person, keyed `cat__YYYY-MM`.
 * - Expenses add your net share to their category.
 * - A purchase on a credit card also moves that share INTO the card's payment
 *   envelope (recorded as negative activity → raises its available).
 * - A transfer INTO a credit account (paying the statement) adds to that card's
 *   payment-envelope activity (drains it back down).
 */
export function activityByCategoryMonth(
  rows: EnvelopeTx[],
  profileId: string,
  arsPerUsd: number,
  paymentCategoryByAccount: Map<string, string> = new Map(),
  receivableByTx: Map<string, number> = new Map(),
): Map<string, number> {
  const map = new Map<string, number>();
  const add = (categoryId: string, month: string, val: number) => {
    if (val === 0) return;
    const k = keyOf(categoryId, month);
    map.set(k, (map.get(k) ?? 0) + val);
  };

  for (const t of rows) {
    const month = monthOf(t.occurred_on);
    if (t.type === 'expense') {
      const share = expenseShareArs(t, profileId, arsPerUsd, receivableByTx.get(t.id) ?? 0);
      if (share <= 0) continue;
      if (t.category_id) add(t.category_id, month, share);
      const payCat = t.account_id ? paymentCategoryByAccount.get(t.account_id) : undefined;
      if (payCat) add(payCat, month, -share); // money set aside to pay the card
    } else if (t.type === 'transfer' && t.profile_id === profileId && t.transfer_account_id) {
      const payCat = paymentCategoryByAccount.get(t.transfer_account_id);
      if (payCat) add(payCat, month, toArs(t.amount, t.currency, arsPerUsd)); // paid the statement
    }
  }
  return map;
}

/**
 * Cumulative available per category through `uptoMonth` (inclusive), in ARS:
 * Σ over every month ≤ uptoMonth of (assigned − activity). Positive and negative
 * balances both carry forward, exactly like YNAB envelopes.
 */
export function availableByCategory(
  assignments: Assignment[],
  activity: Map<string, number>,
  uptoMonth: string,
  arsPerUsd: number,
): Map<string, number> {
  const assignedByKey = new Map<string, number>();
  for (const a of assignments) {
    if (a.month > uptoMonth) continue;
    const k = keyOf(a.category_id, a.month);
    assignedByKey.set(k, (assignedByKey.get(k) ?? 0) + toArs(a.assigned, a.currency, arsPerUsd));
  }

  const out = new Map<string, number>();
  const bump = (categoryId: string, delta: number) =>
    out.set(categoryId, (out.get(categoryId) ?? 0) + delta);

  for (const [k, assigned] of assignedByKey) bump(k.split('__')[0], assigned);
  for (const [k, act] of activity) {
    if (k.slice(k.indexOf('__') + 2) > uptoMonth) continue;
    bump(k.split('__')[0], -act);
  }
  return out;
}

/**
 * The table model for one person for one month: every category that has an
 * assignment or activity (this month or carried over) with its assigned/activity
 * for the month and cumulative available through the month.
 */
export function envelopeRowsForMonth(
  assignments: Assignment[],
  activity: Map<string, number>,
  month: string,
  arsPerUsd: number,
): EnvelopeRow[] {
  const available = availableByCategory(assignments, activity, month, arsPerUsd);
  const assignedThisMonth = new Map<string, number>();
  for (const a of assignments) {
    if (a.month !== month) continue;
    assignedThisMonth.set(
      a.category_id,
      (assignedThisMonth.get(a.category_id) ?? 0) + toArs(a.assigned, a.currency, arsPerUsd),
    );
  }
  const activityThisMonth = new Map<string, number>();
  for (const [k, act] of activity) {
    if (k.slice(k.indexOf('__') + 2) !== month) continue;
    activityThisMonth.set(k.split('__')[0], act);
  }

  const categoryIds = new Set<string>([...available.keys(), ...assignedThisMonth.keys(), ...activityThisMonth.keys()]);
  return [...categoryIds].map((categoryId) => ({
    categoryId,
    assigned: Math.round(assignedThisMonth.get(categoryId) ?? 0),
    activity: Math.round(activityThisMonth.get(categoryId) ?? 0),
    available: Math.round(available.get(categoryId) ?? 0),
  }));
}

/**
 * "Para asignar" (Ready to Assign): your current on-budget cash that isn't yet
 * tucked into a funded envelope — i.e. cash minus the POSITIVE available across
 * your envelopes. Overspent categories (negative available) are surfaced in red
 * for you to cover; they must NOT be added back here, or unbudgeted spending
 * would inflate "Para asignar" back up to roughly your whole balance. Negative
 * result means you've assigned more than you have (or fronted money you're owed).
 */
export function readyToAssign(onBudgetCash: number, availableByCat: Map<string, number>): number {
  let sumFunded = 0;
  for (const v of availableByCat.values()) if (v > 0) sumFunded += v;
  return Math.round(onBudgetCash - sumFunded);
}
