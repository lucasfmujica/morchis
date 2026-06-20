'use client';

// Data hook for the YNAB-style envelope budget of ONE person.
// Fetches accounts, all expense+transfer rows (for carryover & cash), ALL
// monthly assignments (so future-month assignments count toward "Para asignar"),
// friend-debt receivables and category targets, then returns the per-month rows
// plus a GLOBAL "Para asignar" and the plan summary. Everything in ARS.

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { useFx } from '@/hooks/useFx';
import { toArs, isFixedExpense, BUDGET_EXPENSE_SELECT } from '@/lib/budgets';
import { todayISO, monthKey } from '@/lib/date';
import type { AccountTx } from '@/lib/accounts';
import { ageOfMoneyDays, type CashFlow } from '@/lib/ageOfMoney';
import {
  onBudgetCashArs,
  activityByCategoryMonth,
  availableByCategory,
  envelopeRowsForMonth,
  expenseShareArs,
  readyToAssign,
  type EnvelopeAccount,
  type EnvelopeTx,
  type Assignment,
  type EnvelopeRow,
} from '@/lib/envelope';

const FAR_FUTURE = '9999-12';

/** One expense behind a category's monthly activity, with this person's share. */
export interface EnvelopeDetailTx {
  id: string;
  merchant: string | null;
  occurred_on: string;
  amountArs: number;
  shared: boolean;
  fixed: boolean;
}

export interface EnvelopeCategory {
  id: string;
  name: string;
  icon: string;
  kind: string;
  parent_id: string | null;
  color: string | null;
  is_goal: boolean;
}

/** Target info per category (monthly amount or a by-date savings goal). */
export interface TargetInfo {
  cadence: 'monthly' | 'by_date' | 'weekly';
  targetType: 'refill' | 'set_aside'; // refill = top up to X; set_aside = assign X more
  totalArs: number; // by_date: total to reach; monthly/weekly: the amount per period
  targetDate: string | null;
  neededThisMonth: number; // how much more to assign this month to stay on track
  pctComplete: number; // available / totalArs, 0..1 (mainly for goals)
}

export interface EnvelopeSummary {
  totalTargets: number; // Σ this-month's targets across categories
  underfunded: number; // Σ still needed this month to meet targets
  assigned: number; // Σ assigned this month
  spent: number; // Σ spent this month
}

export type AutoAssignStrategy = 'last_assigned' | 'last_spent' | 'avg3_spent' | 'reset_available';

export interface UseEnvelopeResult {
  rows: EnvelopeRow[];
  rowByCategory: Map<string, EnvelopeRow>;
  categories: EnvelopeCategory[];
  targetByCategory: Map<string, number>; // effective monthly target (ARS) per category
  neededByCategory: Map<string, number>; // how much more to assign this month per category
  targetInfoByCategory: Map<string, TargetInfo>;
  summary: EnvelopeSummary;
  assignedFutureByMonth: { month: string; assigned: number }[]; // months after the current real month
  cash: number; // on-budget cash now (ARS) for the viewed person
  ageOfMoney: number | null; // Age of Money in days (FIFO), null if not enough data
  assignedTotal: number; // Σ assigned this month (ARS)
  readyToAssign: number; // Para asignar — GLOBAL (across all months) (ARS)
  transactionsForCategory: (categoryId: string) => EnvelopeDetailTx[];
  lastMonthStats: (categoryId: string) => { assigned: number; activity: number };
  autoAssignAmounts: (strategy: AutoAssignStrategy) => Map<string, number>;
  isLoading: boolean;
  refetch: () => void;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthEndISO(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${month}-${String(last).padStart(2, '0')}`;
}

// Fractional number of weeks in a month (≈4.29–4.43), for weekly targets.
function weeksInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate() / 7;
}

// Inclusive months from `fromMonth` ('YYYY-MM') to the month of `toDateISO`,
// floored at 1 (a target due this month or in the past needs it all now).
function monthsUntil(fromMonth: string, toDateISO: string | null): number {
  if (!toDateISO) return 1;
  const [fy, fm] = fromMonth.split('-').map(Number);
  const [ty, tm] = toDateISO.slice(0, 7).split('-').map(Number);
  return Math.max(1, (ty - fy) * 12 + (tm - fm) + 1);
}

export function useEnvelope(
  householdId: string,
  targetProfileId: string,
  month: string,
): UseEnvelopeResult {
  const supabase = createClient();
  const { arsPerUsd } = useFx();
  const monthEnd = monthEndISO(month);
  const today = todayISO();
  // Load tx at least through today (so cash-now is right when viewing a past
  // month) and through the viewed month (so future-month carryover works).
  const asOfRows = monthEnd > today ? monthEnd : today;

  const categoriesQ = useQuery<EnvelopeCategory[]>({
    queryKey: ['categories', householdId],
    queryFn: async () => {
      const { data } = await supabase
        .from('categories')
        .select('id, name, icon, kind, parent_id, color, is_goal')
        .eq('household_id', householdId)
        .order('name');
      return (data ?? []) as EnvelopeCategory[];
    },
    staleTime: 1000 * 60 * 5,
  });

  const accountsQ = useQuery<EnvelopeAccount[]>({
    queryKey: ['envelope-accounts', householdId],
    queryFn: async () => {
      const { data } = await supabase
        .from('accounts')
        .select('id, type, currency, archived, initial_balance, owner_profile_id, on_budget, payment_category_id')
        .eq('household_id', householdId);
      return (data ?? []) as EnvelopeAccount[];
    },
  });

  const txQ = useQuery<EnvelopeTx[]>({
    queryKey: ['envelope-tx', householdId, asOfRows],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select(`${BUDGET_EXPENSE_SELECT}, id, merchant, type, account_id, transfer_account_id`)
        .eq('household_id', householdId)
        .lte('occurred_on', asOfRows);
      return (data ?? []) as EnvelopeTx[];
    },
  });

  // ALL assignments for the profile (every month, incl. future) — needed for the
  // global "Para asignar" and the "assigned in future months" view.
  const assignmentsQ = useQuery<Assignment[]>({
    queryKey: ['envelope', targetProfileId],
    queryFn: async () => {
      const { data } = await supabase
        .from('budget_months')
        .select('category_id, month, assigned, currency')
        .eq('profile_id', targetProfileId);
      return (data ?? []) as Assignment[];
    },
  });

  const debtsQ = useQuery<{ transaction_id: string | null; amount: number; currency: string }[]>({
    queryKey: ['envelope-debts', targetProfileId],
    queryFn: async () => {
      const { data } = await supabase
        .from('debts')
        .select('transaction_id, amount, currency')
        .eq('profile_id', targetProfileId)
        .eq('direction', 'owed')
        .not('transaction_id', 'is', null);
      return data ?? [];
    },
  });

  const targetsQ = useQuery<{ category_id: string; target_amount: number; currency: string; cadence: string; target_date: string | null; target_type: string | null }[]>({
    queryKey: ['envelope-targets', targetProfileId],
    queryFn: async () => {
      const { data } = await supabase
        .from('category_targets')
        .select('category_id, target_amount, currency, cadence, target_date, target_type')
        .eq('profile_id', targetProfileId);
      return data ?? [];
    },
  });

  const categories = categoriesQ.data ?? [];
  const accounts = accountsQ.data ?? [];
  const tx = txQ.data ?? [];
  const assignments = assignmentsQ.data ?? [];
  const debts = debtsQ.data ?? [];
  const targets = targetsQ.data ?? [];

  const paymentCategoryByAccount = new Map<string, string>();
  for (const a of accounts) {
    if (a.type === 'credit' && a.payment_category_id) paymentCategoryByAccount.set(a.id, a.payment_category_id);
  }

  const receivableByTx = new Map<string, number>();
  for (const d of debts) {
    if (!d.transaction_id) continue;
    receivableByTx.set(d.transaction_id, (receivableByTx.get(d.transaction_id) ?? 0) + toArs(d.amount, d.currency, arsPerUsd));
  }

  // Age of Money: FIFO-match cash inflows (income into on-budget accounts) to
  // outflows (my share of expenses).
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const cashFlows: CashFlow[] = [];
  for (const t of tx) {
    if (t.type === 'income') {
      const acc = t.account_id ? accountById.get(t.account_id) : undefined;
      if (acc && acc.on_budget && acc.type !== 'credit' && !acc.archived && acc.owner_profile_id === targetProfileId) {
        cashFlows.push({ date: t.occurred_on, dir: 'in', ars: toArs(t.amount, t.currency, arsPerUsd) });
      }
    } else if (t.type === 'expense') {
      const share = expenseShareArs(t, targetProfileId, arsPerUsd, receivableByTx.get(t.id) ?? 0);
      if (share > 0) cashFlows.push({ date: t.occurred_on, dir: 'out', ars: share });
    }
  }
  const ageOfMoney = ageOfMoneyDays(cashFlows);

  const activity = activityByCategoryMonth(tx, targetProfileId, arsPerUsd, paymentCategoryByAccount, receivableByTx);
  const rows = envelopeRowsForMonth(assignments, activity, month, arsPerUsd);
  const rowByCategory = new Map(rows.map((r) => [r.categoryId, r]));
  const available = availableByCategory(assignments, activity, month, arsPerUsd); // per viewed month
  const globalAvailable = availableByCategory(assignments, activity, FAR_FUTURE, arsPerUsd);
  const cash = onBudgetCashArs(accounts, tx as unknown as AccountTx[], targetProfileId, today, arsPerUsd);
  const assignedTotal = rows.reduce((s, r) => s + r.assigned, 0);

  // Targets. `targetByCategory` = the effective MONTHLY target amount (for "Cost
  // to Be Me" and the colour); `neededByCategory` = how much MORE to assign this
  // month to stay on track (refill = fill `available` up to X; set_aside = assign
  // X regardless of what's there; weekly = X×weeks; by_date = the per-month slice).
  const targetByCategory = new Map<string, number>();
  const neededByCategory = new Map<string, number>();
  const targetInfoByCategory = new Map<string, TargetInfo>();
  for (const t of targets) {
    const totalArs = toArs(t.target_amount, t.currency, arsPerUsd);
    const avail = available.get(t.category_id) ?? 0;
    const cadence: TargetInfo['cadence'] = t.cadence === 'by_date' ? 'by_date' : t.cadence === 'weekly' ? 'weekly' : 'monthly';
    const targetType: TargetInfo['targetType'] = t.target_type === 'set_aside' ? 'set_aside' : 'refill';
    const assignedThisMonth = rowByCategory.get(t.category_id)?.assigned ?? 0;
    let monthlyTarget = cadence === 'weekly' ? Math.round(totalArs * weeksInMonth(month)) : totalArs;
    let needed: number;
    if (cadence === 'by_date') {
      const monthsLeft = monthsUntil(month, t.target_date);
      monthlyTarget = Math.max(0, Math.round((totalArs - avail) / monthsLeft));
      needed = monthlyTarget;
    } else if (targetType === 'set_aside') {
      needed = Math.max(0, monthlyTarget - assignedThisMonth);
    } else {
      needed = Math.max(0, monthlyTarget - avail);
    }
    targetByCategory.set(t.category_id, monthlyTarget);
    neededByCategory.set(t.category_id, needed);
    targetInfoByCategory.set(t.category_id, {
      cadence,
      targetType,
      totalArs,
      targetDate: t.target_date,
      neededThisMonth: needed,
      pctComplete: totalArs > 0 ? Math.max(0, Math.min(1, avail / totalArs)) : 0,
    });
  }

  // Plan summary (this month).
  let totalTargets = 0;
  let underfunded = 0;
  for (const [, x] of targetByCategory) totalTargets += x;
  for (const [, needed] of neededByCategory) underfunded += needed;
  const spent = rows.reduce((s, r) => s + Math.max(0, r.activity), 0);
  const summary: EnvelopeSummary = { totalTargets, underfunded, assigned: assignedTotal, spent };

  // Assigned in months after the current real month.
  const currentRealMonth = monthKey();
  const futureMap = new Map<string, number>();
  for (const a of assignments) {
    if (a.month > currentRealMonth) futureMap.set(a.month, (futureMap.get(a.month) ?? 0) + toArs(a.assigned, a.currency, arsPerUsd));
  }
  const assignedFutureByMonth = [...futureMap.entries()]
    .map(([m, assigned]) => ({ month: m, assigned }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const transactionsForCategory = (categoryId: string): EnvelopeDetailTx[] =>
    tx
      .filter((t) => t.type === 'expense' && t.category_id === categoryId && t.occurred_on.slice(0, 7) === month)
      .map((t) => ({
        id: t.id,
        merchant: t.merchant ?? null,
        occurred_on: t.occurred_on,
        amountArs: expenseShareArs(t, targetProfileId, arsPerUsd, receivableByTx.get(t.id) ?? 0),
        shared: t.is_shared,
        fixed: isFixedExpense(t),
      }))
      .filter((d) => d.amountArs > 0)
      .sort((a, b) => b.occurred_on.localeCompare(a.occurred_on));

  const prevMonth = shiftMonth(month, -1);
  const lastMonthStats = (categoryId: string) => ({
    assigned: assignments
      .filter((a) => a.category_id === categoryId && a.month === prevMonth)
      .reduce((s, a) => s + toArs(a.assigned, a.currency, arsPerUsd), 0),
    activity: activity.get(`${categoryId}__${prevMonth}`) ?? 0,
  });

  // Quick auto-assign strategies (YNAB-style). Returns the new `assigned` amount
  // (this month) per expense category for the chosen strategy. The caller bulk-
  // upserts these into budget_months.
  const autoAssignAmounts = (strategy: AutoAssignStrategy): Map<string, number> => {
    const p1 = shiftMonth(month, -1), p2 = shiftMonth(month, -2), p3 = shiftMonth(month, -3);
    const out = new Map<string, number>();
    for (const c of categories) {
      if (c.kind !== 'expense') continue;
      let amt = 0;
      if (strategy === 'last_assigned') {
        amt = assignments
          .filter((a) => a.category_id === c.id && a.month === p1)
          .reduce((s, a) => s + toArs(a.assigned, a.currency, arsPerUsd), 0);
      } else if (strategy === 'last_spent') {
        amt = activity.get(`${c.id}__${p1}`) ?? 0;
      } else if (strategy === 'avg3_spent') {
        amt = Math.round(((activity.get(`${c.id}__${p1}`) ?? 0) + (activity.get(`${c.id}__${p2}`) ?? 0) + (activity.get(`${c.id}__${p3}`) ?? 0)) / 3);
      } else if (strategy === 'reset_available') {
        // Set assigned so available becomes 0: newAssigned = currentAssigned − available.
        const row = rowByCategory.get(c.id);
        amt = Math.round((row?.assigned ?? 0) - (row?.available ?? 0));
      }
      if (strategy === 'reset_available') out.set(c.id, Math.max(0, amt));
      else if (amt > 0) out.set(c.id, amt);
    }
    return out;
  };

  return {
    rows,
    rowByCategory,
    categories,
    targetByCategory,
    neededByCategory,
    targetInfoByCategory,
    summary,
    assignedFutureByMonth,
    cash,
    ageOfMoney,
    assignedTotal,
    readyToAssign: readyToAssign(cash, globalAvailable),
    transactionsForCategory,
    lastMonthStats,
    autoAssignAmounts,
    isLoading: categoriesQ.isLoading || accountsQ.isLoading || txQ.isLoading || assignmentsQ.isLoading,
    refetch: () => {
      void assignmentsQ.refetch();
      void txQ.refetch();
    },
  };
}
