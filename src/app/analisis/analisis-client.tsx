'use client';

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { useFx } from '@/hooks/useFx';
import { useInflation } from '@/hooks/useInflation';
import { BottomNav } from '@/components/BottomNav';
import { AddTransactionSheet } from '@/components/AddTransactionSheet';
import { MonthlyBars, SingleBars, lastSixMonths } from '@/components/MonthlyBars';
import { netWorthAt, assetBalance, cardMonthSpend, type AccountRow, type AccountTx } from '@/lib/accounts';
import { ageOfMoneyDays, type CashFlow } from '@/lib/ageOfMoney';
import { myShareArs, type SplitRow } from '@/lib/budgets';
import { toLocalISO } from '@/lib/date';
import { formatARS } from '@/lib/format';
import { toast } from 'sonner';
import Link from 'next/link';

interface Profile {
  id: string;
  household_id: string;
  nickname: string | null;
  display_name: string | null;
}

const DONUT_PALETTE = ['#7EC8A4', '#FF7F6B', '#F5A623', '#6FA8DC', '#B084CC', '#E89AC7', '#5BA886', '#C4B9AE'];

const SEVERITY = {
  positive: { bg: '#E4F2EA', color: '#5BA886', icon: '✨' },
  warning: { bg: '#FFE7E2', color: '#E5604C', icon: '⚠️' },
  info: { bg: '#F0EDE8', color: '#6B6459', icon: '💡' },
} as const;

export default function AnalisisClient({
  profile,
  partnerProfileId,
  partnerName,
}: {
  profile: Profile;
  partnerProfileId?: string;
  partnerName?: string;
}) {
  const supabase = createClient();
  const qc = useQueryClient();
  const { arsPerUsd } = useFx();
  const { rates: inflationRates } = useInflation();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fabType, setFabType] = useState<'expense' | 'income' | 'transfer'>('expense');
  const [refreshing, setRefreshing] = useState(false);
  // Trend chart controls: period (6M/12M) and nominal vs constant pesos.
  const [trendRange, setTrendRange] = useState<'6M' | '12M'>('6M');
  const [constantPesos, setConstantPesos] = useState(true);
  // Month shown in the spending breakdown (null = the latest/current month).
  const [breakdownMonth, setBreakdownMonth] = useState<string | null>(null);
  // Category whose 6-month spend trend is being drilled into (null = closed).
  const [drillCat, setDrillCat] = useState<{ id: string; name: string; icon: string } | null>(null);
  // scope: 'me' (Mío) | 'all' (Nuestro) | 'partner' — default to "Mío"
  const [scope, setScope] = useState<'me' | 'all' | 'partner'>('me');
  const scopeProfileId =
    scope === 'me' ? profile.id : scope === 'partner' ? partnerProfileId : undefined;
  const scopeTabs = [
    { key: 'me' as const, label: 'Mío' },
    { key: 'all' as const, label: 'Nuestro' },
    ...(partnerProfileId ? [{ key: 'partner' as const, label: partnerName || 'Pareja' }] : []),
  ];

  // Computed once per mount so they stay referentially stable across renders
  // (and don't invalidate the memos below on every keystroke/refresh toggle).
  const { months, currentKey, todayStr } = useMemo(() => {
    const t = new Date();
    const ms = lastSixMonths(t);
    return {
      months: ms,
      currentKey: ms[ms.length - 1].key,
      todayStr: toLocalISO(t),
    };
  }, []);

  // The month shown in the spending breakdown, and prev/next bounded to the
  // loaded window. `months` is oldest→newest.
  const bMonth = breakdownMonth ?? currentKey;
  const bIdx = months.findIndex((m) => m.key === bMonth);
  const bMonthLabel = (() => {
    const [y, m] = bMonth.split('-').map(Number);
    const s = new Date(y, m - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  })();

  // Months covered by the trend chart. For 12M we prepend the 6 months before
  // the standard window, reusing lastSixMonths anchored just before it.
  const trendMonths = useMemo(() => {
    if (trendRange === '6M') return months;
    const [y0, m0] = months[0].key.split('-').map(Number);
    // new Date(y0, m0 - 2, 1) = the month right before the 6M window start.
    return [...lastSixMonths(new Date(y0, m0 - 2, 1)), ...months];
  }, [months, trendRange]);
  const trendRangeStart = `${trendMonths[0].key}-01`;

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('categories')
        .select('id, name, icon, color, kind, parent_id, is_goal')
        .eq('household_id', profile.household_id)
        .order('name');
      return data ?? [];
    },
  });

  // Range widens only when 12M is selected (the start date is in the key, so
  // 6M keeps its cached slimmer fetch and 12M gets its own).
  const { data: txns = [] } = useQuery({
    queryKey: ['transactions', profile.household_id, 'analisis', trendRangeStart],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('id, amount, type, occurred_on, category_id, profile_id, currency, is_shared, scope, merchant, splits(payer_profile_id, ower_profile_id, amount)')
        .eq('household_id', profile.household_id)
        .gte('occurred_on', trendRangeStart)
        // Don't pull future-dated installment rows — Análisis only looks back.
        .lte('occurred_on', todayStr);
      return data ?? [];
    },
    // Avoid the chart flashing empty while the wider 12M range loads.
    placeholderData: (prev) => prev,
  });

  const { data: members = [] } = useQuery({
    queryKey: ['household-members', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, nickname, display_name')
        .eq('household_id', profile.household_id);
      return data ?? [];
    },
  });

  const { data: accounts = [] } = useQuery<(AccountRow & { on_budget: boolean })[]>({
    queryKey: ['accounts-full', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('accounts')
        .select('id, type, currency, archived, initial_balance, owner_profile_id, on_budget')
        .eq('household_id', profile.household_id);
      return (data ?? []) as (AccountRow & { on_budget: boolean })[];
    },
  });

  const { data: accountTx = [] } = useQuery<AccountTx[]>({
    queryKey: ['account-tx', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('account_id, transfer_account_id, type, amount, occurred_on')
        .eq('household_id', profile.household_id)
        .not('account_id', 'is', null);
      return (data ?? []) as AccountTx[];
    },
  });

  const { data: savingsTargetRows = [] } = useQuery({
    queryKey: ['savings_goals', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('savings_goals')
        .select('month, target_pct')
        .eq('household_id', profile.household_id);
      return data ?? [];
    },
  });

  // Insights are tagged by audience: profile_id null = household ("Nuestro"),
  // otherwise that person's own ("Mío"/pareja). Show the set for the active tab.
  const { data: insights = [] } = useQuery({
    queryKey: ['insights', profile.household_id, scopeProfileId ?? 'all'],
    queryFn: async () => {
      let q = supabase
        .from('insights')
        .select('id, title, body, severity, created_at')
        .eq('household_id', profile.household_id);
      q = scopeProfileId ? q.eq('profile_id', scopeProfileId) : q.is('profile_id', null);
      const { data } = await q.order('created_at', { ascending: false }).limit(4);
      return data ?? [];
    },
  });

  // USD amounts are converted to ARS so charts/totals are in one currency.
  const toArs = useCallback(
    (amount: number, currency?: string | null) =>
      currency === 'USD' && arsPerUsd > 0 ? Math.round(amount * arsPerUsd) : amount,
    [arsPerUsd],
  );

  // Re-express a past month's nominal ARS amount in today's pesos. Same
  // cumulative-factor math as useInflation's arsToRealARS but in the inverse
  // direction: multiply a *past* amount up to the latest known month instead
  // of deflating a current amount back to a past base.
  const inflateToToday = useCallback(
    (amount: number, monthKey: string): number => {
      if (inflationRates.length === 0) return amount;
      const factor = inflationRates
        .filter((r) => r.date.slice(0, 7) > monthKey)
        .reduce((acc, r) => acc * (1 + r.monthly_pct / 100), 1);
      return Math.round(amount * factor);
    },
    [inflationRates],
  );
  // Fall back to nominal silently if inflation data hasn't loaded.
  const inflationActive = constantPesos && inflationRates.length > 0;

  type Txn = {
    id: string;
    amount: number;
    type: string;
    occurred_on: string;
    category_id: string | null;
    profile_id: string;
    currency: string;
    is_shared: boolean;
    scope: string;
    merchant: string | null;
    splits: SplitRow[] | null;
  };
  const allTxns = txns as Txn[];

  // How much of an expense counts for a given person, in ARS. A shared expense
  // is split (each only carries their part, whoever paid); a solo expense counts
  // only for its owner. This mirrors the budgets math so Análisis, Presupuestos
  // and the couple balance all agree on "who spent what".
  const expenseShareArs = useCallback(
    (t: Txn, pid: string | undefined): number => {
      if (!pid) return toArs(t.amount, t.currency); // "Nuestro" → combined household
      if (!t.is_shared) return t.profile_id === pid ? toArs(t.amount, t.currency) : 0;
      return myShareArs(t, pid, arsPerUsd);
    },
    [toArs, arsPerUsd],
  );

  const scopedAccounts = useMemo(
    () => (scopeProfileId ? accounts.filter((a) => a.owner_profile_id === scopeProfileId) : accounts),
    [accounts, scopeProfileId],
  );

  // Category breakdown (current month, attributed by share) + the subscriptions
  // radar that reuses the same per-category totals. Recomputed only when the
  // transactions, categories or active scope change.
  const { monthExpense, catRows, segments, subRows, subsTotal } = useMemo(() => {
    const catById = new Map(categories.map((c) => [c.id, c]));
    const spentByCat = new Map<string, number>();
    for (const t of allTxns) {
      if (t.type !== 'expense' || !t.occurred_on.startsWith(bMonth) || t.occurred_on > todayStr || !t.category_id) continue;
      const share = expenseShareArs(t, scopeProfileId);
      if (share > 0) spentByCat.set(t.category_id, (spentByCat.get(t.category_id) ?? 0) + share);
    }
    const catRows = [...spentByCat.entries()]
      .map(([id, value], i) => {
        const cat = catById.get(id);
        return { id, cat, value, color: cat?.color || DONUT_PALETTE[i % DONUT_PALETTE.length] };
      })
      .filter((r) => r.cat && r.value > 0)
      .sort((a, b) => b.value - a.value);
    const monthExpense = catRows.reduce((s, r) => s + r.value, 0);
    const TOP = 6;
    const topCats = catRows.slice(0, TOP);
    const restTotal = catRows.slice(TOP).reduce((s, r) => s + r.value, 0);
    const segments = topCats.map((r) => ({ label: r.cat!.name, value: r.value, color: r.color }));
    if (restTotal > 0) segments.push({ label: 'Otras', value: restTotal, color: '#C4B9AE' });

    // Subscriptions radar — current-month spend in subscription-type categories.
    // Match by keyword (substring) so variants like "Suscripción" or "Streaming
    // & apps" still count, instead of requiring an exact category name.
    const SUB_KEYWORDS = ['streaming', 'servicios digitales', 'suscrip', 'netflix', 'spotify', 'apps'];
    const subCatIds = new Set(
      categories
        .filter((c) => {
          const n = c.name.trim().toLowerCase();
          return SUB_KEYWORDS.some((k) => n.includes(k));
        })
        .map((c) => c.id),
    );
    const subRows = [...spentByCat.entries()]
      .filter(([id]) => subCatIds.has(id))
      .map(([id, value]) => ({ cat: catById.get(id), value }))
      .filter((r) => r.cat && r.value > 0)
      .sort((a, b) => b.value - a.value);
    const subsTotal = subRows.reduce((s, r) => s + r.value, 0);
    return { monthExpense, catRows, segments, subRows, subsTotal };
  }, [allTxns, categories, scopeProfileId, bMonth, todayStr, expenseShareArs]);

  // Per-person comparison — each person's current-month *share* (so a shared
  // bill is split, not credited entirely to whoever fronted it). Always across
  // both members, independent of the scope toggle.
  const { personRows, personMax } = useMemo(() => {
    const spentByPerson = new Map<string, number>();
    for (const m of members) {
      let total = 0;
      for (const t of allTxns) {
        if (t.type !== 'expense' || !t.occurred_on.startsWith(currentKey) || t.occurred_on > todayStr) continue;
        total += expenseShareArs(t, m.id);
      }
      if (total > 0) spentByPerson.set(m.id, total);
    }
    const memberName = (id: string) => {
      const m = members.find((x) => x.id === id);
      const base = m?.nickname || m?.display_name || 'Morch';
      return id === profile.id ? `${base} (vos)` : base;
    };
    const personRows = [...spentByPerson.entries()]
      .map(([id, value]) => ({ id, name: memberName(id), value }))
      .sort((a, b) => b.value - a.value);
    return { personRows, personMax: Math.max(1, ...personRows.map((r) => r.value)) };
  }, [allTxns, members, currentKey, todayStr, expenseShareArs, profile.id]);

  // Trend income vs expense (6 or 12 months). Expenses use each person's share
  // for the scoped view; income isn't shared, so it's attributed to its owner.
  // With "$ constantes" on, each month is re-expressed in today's pesos so the
  // nominal-inflation drift doesn't read as "spending more".
  const trendRows = useMemo(
    () =>
      trendMonths.map((m) => {
        let income = 0;
        let expense = 0;
        for (const t of allTxns) {
          if (!t.occurred_on.startsWith(m.key)) continue;
          if (t.type === 'income') {
            if (!scopeProfileId || t.profile_id === scopeProfileId) income += toArs(t.amount, t.currency);
          } else if (t.type === 'expense') {
            expense += expenseShareArs(t, scopeProfileId);
          }
        }
        if (inflationActive) {
          income = inflateToToday(income, m.key);
          expense = inflateToToday(expense, m.key);
        }
        return { ...m, income, expense, rate: income > 0 ? (income - expense) / income : null };
      }),
    [trendMonths, allTxns, scopeProfileId, toArs, expenseShareArs, inflationActive, inflateToToday],
  );

  // Insight headline: on average, do you spend less than you make? (closed months)
  const spendingInsight = useMemo(() => {
    const closed = trendRows.filter((r) => r.key !== currentKey && (r.income > 0 || r.expense > 0));
    if (closed.length === 0) return null;
    const avgInc = closed.reduce((s, r) => s + r.income, 0) / closed.length;
    const avgExp = closed.reduce((s, r) => s + r.expense, 0) / closed.length;
    return avgInc >= avgExp;
  }, [trendRows, currentKey]);

  // Net-worth composition: on-budget cash vs tracking (off-budget) vs card debt.
  const composition = useMemo(() => {
    let onBudget = 0, tracking = 0, cardDebt = 0;
    const monthStart = `${currentKey}-01`;
    for (const a of accounts) {
      if (a.archived) continue;
      if (a.type === 'credit') {
        cardDebt += cardMonthSpend(accountTx, a.id, monthStart, todayStr);
        continue;
      }
      const bal = assetBalance(accountTx, a.id, a.initial_balance ?? 0, todayStr);
      const ars = a.currency === 'USD' && arsPerUsd > 0 ? bal * arsPerUsd : bal;
      if (a.on_budget) onBudget += ars; else tracking += ars;
    }
    return { onBudget: Math.round(onBudget), tracking: Math.round(tracking), cardDebt: Math.round(cardDebt) };
  }, [accounts, accountTx, arsPerUsd, currentKey, todayStr]);

  // Savings rate this month vs the household target (savings_goals.target_pct).
  const savingsVsTarget = useMemo(() => {
    const cur = trendRows.find((r) => r.key === currentKey);
    const rate = cur && cur.income > 0 ? (cur.income - cur.expense) / cur.income : null;
    const target = (savingsTargetRows.find((s) => s.month === currentKey)?.target_pct ?? 20) / 100;
    return { rate, target };
  }, [trendRows, currentKey, savingsTargetRows]);

  // 6-month spend line for one category (this person's share) — for the drill sheet.
  const categoryTrend = (catId: string) =>
    trendMonths.map((m) => {
      let v = 0;
      for (const t of allTxns) {
        if (t.type !== 'expense' || t.category_id !== catId || !t.occurred_on.startsWith(m.key)) continue;
        v += expenseShareArs(t, scopeProfileId);
      }
      return { key: m.key, label: m.label, value: Math.round(v) };
    });

  // "Total del año" — sum of the 12 trend months (already constant-pesos
  // adjusted when the toggle is on). Only shown in the 12M view.
  const yearTotals = useMemo(() => {
    if (trendRange !== '12M') return null;
    return trendRows.reduce(
      (acc, r) => ({ income: acc.income + r.income, expense: acc.expense + r.expense }),
      { income: 0, expense: 0 },
    );
  }, [trendRange, trendRows]);

  // 6-month net worth. We only have current balances (initial_balance is a "now"
  // snapshot), so we can't reconstruct net worth for months before there was any
  // activity — those would wrongly show the full balance. Blank them out.
  const { nwRows, currentNetWorth, nwDelta } = useMemo(() => {
    const allDates = [...txns.map((t) => t.occurred_on), ...accountTx.map((t) => t.occurred_on)];
    const firstDataMonth = allDates.length ? allDates.reduce((a, b) => (a < b ? a : b)).slice(0, 7) : currentKey;
    const nwRows = months.map((m) => {
      if (m.key < firstDataMonth) return { key: m.key, label: m.label, value: 0 };
      const [y, mo] = m.key.split('-').map(Number);
      const monthEnd = toLocalISO(new Date(y, mo, 0));
      const asOf = monthEnd > todayStr ? todayStr : monthEnd;
      return { key: m.key, label: m.label, value: netWorthAt(scopedAccounts, accountTx, asOf, arsPerUsd) };
    });
    const currentNetWorth = nwRows[nwRows.length - 1]?.value ?? 0;
    const prevMonthKey = months[months.length - 2]?.key;
    const prevHasData = prevMonthKey != null && prevMonthKey >= firstDataMonth;
    const nwDelta = prevHasData ? currentNetWorth - (nwRows[nwRows.length - 2]?.value ?? 0) : null;
    return { nwRows, currentNetWorth, nwDelta };
  }, [txns, accountTx, scopedAccounts, months, currentKey, todayStr, arsPerUsd]);

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  // Age of Money — FIFO-match the scope's cash in (income) vs out (what they
  // paid). Approximate over the loaded window; null until there's enough flow.
  const ageOfMoney = useMemo(() => {
    const flows: CashFlow[] = [];
    for (const t of allTxns) {
      if (t.type !== 'income' && t.type !== 'expense') continue;
      if (scopeProfileId && t.profile_id !== scopeProfileId) continue;
      const ars = toArs(t.amount, t.currency);
      if (ars <= 0) continue;
      flows.push({ date: t.occurred_on, dir: t.type === 'income' ? 'in' : 'out', ars });
    }
    return ageOfMoneyDays(flows);
  }, [allTxns, scopeProfileId, toArs]);

  // Top merchants for the breakdown month (Spending by Payee), by share.
  const topMerchants = useMemo(() => {
    const byMerchant = new Map<string, number>();
    for (const t of allTxns) {
      if (t.type !== 'expense' || !t.occurred_on.startsWith(bMonth) || t.occurred_on > todayStr) continue;
      const share = expenseShareArs(t, scopeProfileId);
      if (share <= 0) continue;
      const name = t.merchant?.trim() || 'Sin comercio';
      byMerchant.set(name, (byMerchant.get(name) ?? 0) + share);
    }
    const all = [...byMerchant.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    return { rows: all.slice(0, 6), total: all.reduce((s, r) => s + r.value, 0) };
  }, [allTxns, bMonth, todayStr, scopeProfileId, expenseShareArs]);

  // Biggest single expenses of the breakdown month.
  const biggestExpenses = useMemo(() => {
    const rows: { id: string; merchant: string | null; cat: (typeof categories)[number] | undefined; value: number; date: string }[] = [];
    for (const t of allTxns) {
      if (t.type !== 'expense' || !t.occurred_on.startsWith(bMonth) || t.occurred_on > todayStr) continue;
      const share = expenseShareArs(t, scopeProfileId);
      if (share <= 0) continue;
      rows.push({ id: t.id, merchant: t.merchant, cat: catById.get(t.category_id ?? ''), value: share, date: t.occurred_on });
    }
    return rows.sort((a, b) => b.value - a.value).slice(0, 5);
  }, [allTxns, bMonth, todayStr, scopeProfileId, expenseShareArs, catById]);

  // Income by source (category) for the breakdown month.
  const incomeBySource = useMemo(() => {
    const byCat = new Map<string, number>();
    for (const t of allTxns) {
      if (t.type !== 'income' || !t.occurred_on.startsWith(bMonth) || t.occurred_on > todayStr) continue;
      if (scopeProfileId && t.profile_id !== scopeProfileId) continue;
      const ars = toArs(t.amount, t.currency);
      if (ars <= 0) continue;
      byCat.set(t.category_id ?? 'none', (byCat.get(t.category_id ?? 'none') ?? 0) + ars);
    }
    const rows = [...byCat.entries()]
      .map(([id, value]) => ({ cat: catById.get(id), value }))
      .sort((a, b) => b.value - a.value);
    return { rows, total: rows.reduce((s, r) => s + r.value, 0) };
  }, [allTxns, bMonth, todayStr, scopeProfileId, toArs, catById]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error('Iniciá sesión de nuevo para actualizar.');
        return;
      }
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/generate-insights`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'full' }),
      });
      const data = await res.json().catch(() => null);
      await qc.invalidateQueries({ queryKey: ['insights', profile.household_id] });
      if (!res.ok || !data?.ok) {
        toast.error(
          data && data.generated === 0
            ? 'No se generaron insights (faltan datos del mes o el análisis falló). Probá más tarde.'
            : 'No se pudieron actualizar los insights. Probá de nuevo.',
        );
        return;
      }
      toast.success(`${data.generated} insight${data.generated === 1 ? '' : 's'} actualizado${data.generated === 1 ? '' : 's'} ✓`);
    } catch (e) {
      console.error(e);
      toast.error('No se pudieron actualizar los insights. Probá de nuevo.');
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F9F5F0' }}>
      <header className="px-5 pt-14 pb-4">
        <h1 className="text-2xl font-black" style={{ color: '#2D2D2D' }}>Análisis 📊</h1>
      </header>

      {/* Scope toggle: Mío / Nuestro / pareja */}
      <div className="mx-4 mb-3 flex rounded-2xl overflow-hidden p-1 gap-1" style={{ background: '#ECE5DC' }}>
        {scopeTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setScope(tab.key)}
            className="flex-1 py-1.5 text-xs font-bold rounded-xl transition-colors"
            style={{
              background: scope === tab.key ? '#FFFFFF' : 'transparent',
              color: scope === tab.key ? '#2D2D2D' : '#6B6459',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="px-4 flex flex-col gap-4">
        {/* Net worth hero */}
        <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
          <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: '#6B6459' }}>💰 Patrimonio</p>
          <div className="flex items-end justify-between mb-3">
            <p className="text-3xl font-black leading-none" style={{ color: '#2D2D2D', fontVariantNumeric: 'tabular-nums' }}>
              {formatARS(currentNetWorth)}
            </p>
            {nwDelta != null && (
              <span
                className="text-xs font-bold px-2 py-1 rounded-full"
                style={{ background: nwDelta >= 0 ? '#E4F2EA' : '#FFE7E2', color: nwDelta >= 0 ? '#5BA886' : '#E5604C' }}
              >
                {nwDelta >= 0 ? '▲' : '▼'} {formatARS(Math.abs(nwDelta))} vs mes ant.
              </span>
            )}
          </div>
          <SingleBars rows={nwRows} color="#7EC8A4" />
        </div>

        {/* Composition: on-budget cash vs tracking vs card debt */}
        <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
          <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: '#6B6459' }}>🧩 Composición</p>
          {(() => {
            const total = Math.max(1, composition.onBudget + composition.tracking);
            return (
              <>
                <div className="flex h-2.5 rounded-full overflow-hidden mb-3" style={{ background: '#F1ECE4' }}>
                  <div style={{ width: `${(composition.onBudget / total) * 100}%`, background: '#7EC8A4' }} />
                  <div style={{ width: `${(composition.tracking / total) * 100}%`, background: '#6FA8DC' }} />
                </div>
                {[
                  { label: '💵 En presupuesto', v: composition.onBudget, c: '#5BA886' },
                  { label: '👁️ Seguimiento', v: composition.tracking, c: '#5B8DEF' },
                  { label: '💳 Deuda tarjetas (ciclo)', v: -composition.cardDebt, c: '#E5604C' },
                ].map((r) => (
                  <div key={r.label} className="flex items-center justify-between py-1">
                    <span className="text-sm" style={{ color: '#6B6459' }}>{r.label}</span>
                    <span className="text-sm font-black tabular-nums" style={{ color: r.c }}>{formatARS(r.v)}</span>
                  </div>
                ))}
              </>
            );
          })()}
        </div>

        {/* Age of Money — YNAB Reflect signature metric */}
        {ageOfMoney != null && (
          <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
            <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: '#6B6459' }}>🕰️ Antigüedad del dinero</p>
            <div className="flex items-end gap-2">
              <p className="text-3xl font-black leading-none" style={{ color: '#2D2D2D', fontVariantNumeric: 'tabular-nums' }}>{ageOfMoney}</p>
              <p className="text-sm font-bold mb-0.5" style={{ color: '#6B6459' }}>{ageOfMoney === 1 ? 'día' : 'días'}</p>
            </div>
            <p className="text-[11px] mt-2" style={{ color: '#6B6459' }}>
              {ageOfMoney < 30
                ? 'Gastás plata que entró hace poco — vivís bastante al día.'
                : ageOfMoney < 60
                  ? 'Buen colchón: gastás plata de hace más de un mes.'
                  : 'Gran colchón: la plata que gastás tiene más de dos meses. 🎉'}
            </p>
          </div>
        )}

        {/* Savings rate vs target */}
        {savingsVsTarget.rate != null && (
          <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#6B6459' }}>🎯 Ahorro vs meta</p>
              <span className="text-xs font-bold" style={{ color: savingsVsTarget.rate >= savingsVsTarget.target ? '#5BA886' : '#C79A2B' }}>
                {Math.round(savingsVsTarget.rate * 100)}% / meta {Math.round(savingsVsTarget.target * 100)}%
              </span>
            </div>
            <div className="h-3 rounded-full overflow-hidden" style={{ background: '#ECE5DC' }}>
              <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, savingsVsTarget.rate * 100))}%`, background: savingsVsTarget.rate >= savingsVsTarget.target ? '#7EC8A4' : '#F5A623' }} />
            </div>
            <p className="text-[11px] mt-2" style={{ color: '#6B6459' }}>
              {savingsVsTarget.rate >= savingsVsTarget.target ? '¡Vas por arriba de tu meta de ahorro! 🎉' : 'Estás por debajo de tu meta de ahorro de este mes.'}
            </p>
          </div>
        )}

        {/* Spending breakdown — total + segmented bar + per-category % bars */}
        <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
          {/* Month selector */}
          <div className="flex items-center justify-center gap-2 mb-3">
            <button
              onClick={() => bIdx > 0 && setBreakdownMonth(months[bIdx - 1].key)}
              disabled={bIdx <= 0}
              className="w-8 h-8 rounded-full text-lg flex items-center justify-center"
              style={{ background: '#F9F5F0', color: bIdx <= 0 ? '#D9CFC2' : '#6B6459' }}
              aria-label="Mes anterior"
            >
              ‹
            </button>
            <span className="text-sm font-bold min-w-[8rem] text-center" style={{ color: '#2D2D2D' }}>{bMonthLabel}</span>
            <button
              onClick={() => bIdx >= 0 && bIdx < months.length - 1 && setBreakdownMonth(months[bIdx + 1].key)}
              disabled={bIdx >= months.length - 1}
              className="w-8 h-8 rounded-full text-lg flex items-center justify-center"
              style={{ background: '#F9F5F0', color: bIdx >= months.length - 1 ? '#D9CFC2' : '#6B6459' }}
              aria-label="Mes siguiente"
            >
              ›
            </button>
          </div>

          {/* Total */}
          <p className="text-xs font-bold uppercase tracking-wide text-center" style={{ color: '#6B6459' }}>Gasto total</p>
          <p className="text-3xl font-black text-center mb-3" style={{ color: '#2D2D2D', fontVariantNumeric: 'tabular-nums' }}>
            {formatARS(monthExpense)}
          </p>

          {catRows.length === 0 ? (
            <p className="text-sm text-center py-6" style={{ color: '#6B6459' }}>Sin gastos este mes.</p>
          ) : (
            <>
              {/* Segmented bar */}
              <div className="flex h-3 rounded-full overflow-hidden mb-4" style={{ background: '#F1ECE4' }}>
                {segments.map((s, i) => (
                  <div key={i} style={{ width: `${(s.value / monthExpense) * 100}%`, background: s.color }} />
                ))}
              </div>

              {/* Category list with per-row % bars */}
              <div className="flex flex-col">
                {catRows.map((r) => {
                  const pct = Math.round((r.value / monthExpense) * 100);
                  return (
                    <button key={r.id} onClick={() => setDrillCat({ id: r.id, name: r.cat!.name, icon: r.cat!.icon })} className="flex items-center gap-3 py-2.5 text-left w-full">
                      <span className="text-xl shrink-0">{r.cat!.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold truncate" style={{ color: '#2D2D2D' }}>{r.cat!.name}</span>
                          <span className="text-sm font-black tabular-nums shrink-0" style={{ color: '#2D2D2D' }}>{formatARS(r.value)}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#F1ECE4' }}>
                            <div className="h-full rounded-full" style={{ width: `${Math.max(pct, 2)}%`, background: r.color }} />
                          </div>
                          <span className="text-[11px] font-semibold tabular-nums w-8 text-right" style={{ color: '#6B6459' }}>{pct}%</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Top merchants (Spending by Payee) */}
        {topMerchants.rows.length > 0 && (
          <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
            <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: '#6B6459' }}>🏪 Top comercios · {bMonthLabel}</p>
            <div className="flex flex-col gap-2.5">
              {topMerchants.rows.map((r) => {
                const pct = topMerchants.total > 0 ? Math.round((r.value / topMerchants.total) * 100) : 0;
                return (
                  <div key={r.name}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-semibold truncate" style={{ color: '#2D2D2D' }}>{r.name}</span>
                      <span className="text-sm font-black tabular-nums ml-2 shrink-0" style={{ color: '#2D2D2D' }}>{formatARS(r.value)}</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#F1ECE4' }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: '#7EC8A4' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Biggest single expenses */}
        {biggestExpenses.length > 0 && (
          <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
            <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: '#6B6459' }}>💸 Gastos más grandes · {bMonthLabel}</p>
            <div className="flex flex-col gap-2.5">
              {biggestExpenses.map((e) => (
                <div key={e.id} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-base shrink-0" style={{ background: '#F9F5F0' }}>{e.cat?.icon || '🧾'}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: '#2D2D2D' }}>{e.merchant || e.cat?.name || 'Gasto'}</p>
                    <p className="text-[11px]" style={{ color: '#6B6459' }}>{e.date.slice(8, 10)}/{e.date.slice(5, 7)}{e.cat ? ` · ${e.cat.name}` : ''}</p>
                  </div>
                  <span className="text-sm font-black tabular-nums shrink-0" style={{ color: '#FF7F6B' }}>{formatARS(e.value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Income vs expense trend (6M/12M, nominal or constant pesos) */}
        <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
          {spendingInsight != null && (
            <p className="text-base font-black mb-3 leading-snug" style={{ color: '#2D2D2D' }}>
              {spendingInsight ? 'En promedio, gastás menos de lo que ganás. 🎉' : 'En promedio, estás gastando más de lo que ganás. ⚠️'}
            </p>
          )}
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#6B6459' }}>
              📈 Ingresos vs gastos · {trendRange === '12M' ? '12 meses' : '6 meses'}
            </p>
            <div className="flex rounded-full p-0.5 gap-0.5" style={{ background: '#ECE5DC' }}>
              {(['6M', '12M'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setTrendRange(r)}
                  className="px-2.5 py-1 text-[10px] font-bold rounded-full transition-colors"
                  style={{
                    background: trendRange === r ? '#FFFFFF' : 'transparent',
                    color: trendRange === r ? '#2D2D2D' : '#6B6459',
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex rounded-full p-0.5 gap-0.5" style={{ background: '#ECE5DC' }}>
              {([
                { key: false, label: '$ corrientes' },
                { key: true, label: '$ constantes' },
              ] as const).map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => setConstantPesos(opt.key)}
                  className="px-2.5 py-1 text-[10px] font-bold rounded-full transition-colors"
                  style={{
                    background: constantPesos === opt.key ? '#FFFFFF' : 'transparent',
                    color: constantPesos === opt.key ? '#2D2D2D' : '#6B6459',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {inflationActive && (
              <span className="text-[10px]" style={{ color: '#C4B9AE' }}>ajustado por inflación (INDEC)</span>
            )}
          </div>
          <div className="flex items-center gap-4 mb-3 text-[11px]">
            <span className="flex items-center gap-1.5" style={{ color: '#5BA886' }}>
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#7EC8A4' }} /> Ingresos
            </span>
            <span className="flex items-center gap-1.5" style={{ color: '#E5604C' }}>
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#FF7F6B' }} /> Gastos
            </span>
            <span className="ml-auto" style={{ color: '#6B6459' }}>% = ahorro</span>
          </div>
          {/* 12 columns don't fit a phone width with fixed-width bars — let the chart scroll. */}
          <div className={trendRange === '12M' ? 'overflow-x-auto -mx-1 px-1' : undefined}>
            <div style={trendRange === '12M' ? { minWidth: 480 } : undefined}>
              <MonthlyBars rows={trendRows} />
            </div>
          </div>
          {yearTotals && (
            <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: '1px solid #ECE5DC' }}>
              <span className="text-xs font-bold" style={{ color: '#6B6459' }}>Total del año</span>
              <span className="text-xs font-black" style={{ fontVariantNumeric: 'tabular-nums' }}>
                <span style={{ color: '#5BA886' }}>{formatARS(yearTotals.income)}</span>
                <span style={{ color: '#C4B9AE' }}> · </span>
                <span style={{ color: '#E5604C' }}>{formatARS(yearTotals.expense)}</span>
              </span>
            </div>
          )}
        </div>

        {/* Income by source */}
        {incomeBySource.rows.length > 0 && (
          <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
            <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: '#6B6459' }}>💵 Ingresos por fuente · {bMonthLabel}</p>
            <div className="flex flex-col gap-2.5">
              {incomeBySource.rows.map((r, i) => {
                const pct = incomeBySource.total > 0 ? Math.round((r.value / incomeBySource.total) * 100) : 0;
                return (
                  <div key={r.cat?.id ?? `none-${i}`} className="flex items-center gap-3">
                    <span className="text-base shrink-0">{r.cat?.icon || '💰'}</span>
                    <span className="flex-1 text-sm font-semibold truncate" style={{ color: '#2D2D2D' }}>{r.cat?.name || 'Sin categoría'}</span>
                    <span className="text-xs font-bold tabular-nums" style={{ color: '#6B6459' }}>{pct}%</span>
                    <span className="text-sm font-black tabular-nums shrink-0 text-right" style={{ color: '#5BA886', minWidth: '5.5rem' }}>{formatARS(r.value)}</span>
                  </div>
                );
              })}
              <div className="flex items-center justify-between pt-2 mt-1" style={{ borderTop: '1px solid #ECE5DC' }}>
                <span className="text-xs font-bold uppercase tracking-wide" style={{ color: '#6B6459' }}>Total</span>
                <span className="text-sm font-black tabular-nums" style={{ color: '#5BA886' }}>{formatARS(incomeBySource.total)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Per-person comparison */}
        {personRows.length > 1 && (
          <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
            <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: '#6B6459' }}>👥 Quién gastó qué · este mes</p>
            <div className="flex flex-col gap-3">
              {personRows.map((p, i) => (
                <div key={p.id}>
                  <div className="flex justify-between items-baseline mb-1">
                    <span className="text-sm font-bold" style={{ color: '#2D2D2D' }}>{p.name}</span>
                    <span className="text-sm font-black" style={{ color: '#FF7F6B' }}>{formatARS(p.value)}</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: '#ECE5DC' }}>
                    <div className="h-full rounded-full" style={{ width: `${(p.value / personMax) * 100}%`, background: i === 0 ? '#FF7F6B' : '#6FA8DC' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Subscriptions radar */}
        {subRows.length > 0 && (
          <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#6B6459' }}>📡 Suscripciones · este mes</p>
              <span className="text-xs font-black" style={{ color: '#FF7F6B' }}>{formatARS(subsTotal)}</span>
            </div>
            <div className="flex flex-col gap-2">
              {subRows.map((r) => (
                <button key={r.cat!.id} onClick={() => setDrillCat({ id: r.cat!.id, name: r.cat!.name, icon: r.cat!.icon })} className="flex items-center gap-2 text-left w-full">
                  <span className="text-lg">{r.cat!.icon}</span>
                  <span className="text-sm flex-1 truncate" style={{ color: '#2D2D2D' }}>{r.cat!.name}</span>
                  <span className="text-sm font-bold" style={{ color: '#2D2D2D' }}>{formatARS(r.value)}</span>
                  <span className="text-[10px]" style={{ color: '#C4B9AE' }}>›</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* AI insights */}
        <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#6B6459' }}>Insights ✨</p>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="text-xs font-bold px-3 py-1.5 rounded-full"
              style={{ background: refreshing ? '#ECE5DC' : '#7EC8A4', color: refreshing ? '#6B6459' : '#FFFFFF' }}
            >
              {refreshing ? 'Analizando…' : 'Actualizar'}
            </button>
          </div>
          {insights.length === 0 ? (
            <p className="text-sm text-center py-4" style={{ color: '#6B6459' }}>Tocá &quot;Actualizar&quot; para que la IA analice tus gastos.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {insights.map((ins) => {
                const s = SEVERITY[(ins.severity as keyof typeof SEVERITY)] ?? SEVERITY.info;
                return (
                  <Link key={ins.id} href={`/insights/${ins.id}`} className="rounded-2xl p-3 flex items-start gap-2.5" style={{ background: s.bg }}>
                    <span className="text-lg shrink-0">{s.icon}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-black text-sm leading-tight" style={{ color: s.color }}>{ins.title}</p>
                      <p className="text-xs mt-0.5 leading-snug" style={{ color: s.color, opacity: 0.85 }}>{ins.body}</p>
                    </div>
                    <span className="text-[10px] self-center" style={{ color: s.color }}>›</span>
                  </Link>
                );
              })}
              <Link href="/insights" className="text-xs font-bold text-center pt-1" style={{ color: '#5BA886' }}>
                Ver todos los insights →
              </Link>
            </div>
          )}
        </div>
      </div>

      {drillCat && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center" style={{ background: 'rgba(45,45,45,0.4)' }} onClick={() => setDrillCat(null)}>
          <div className="w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl p-6" style={{ background: '#FFFFFF', paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }} onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: '#ECE5DC' }} />
            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xl">{drillCat.icon}</span>
              <h2 className="text-lg font-black" style={{ color: '#2D2D2D' }}>{drillCat.name}</h2>
            </div>
            <p className="text-xs mb-4" style={{ color: '#6B6459' }}>Gasto de los últimos {trendMonths.length} meses (tu parte)</p>
            <SingleBars rows={categoryTrend(drillCat.id)} color="#FF7F6B" />
          </div>
        </div>
      )}

      <BottomNav onFab={(type) => { setFabType(type); setSheetOpen(true); }} />
      <AddTransactionSheet
        open={sheetOpen}
        initialType={fabType}
        onClose={() => setSheetOpen(false)}
        householdId={profile.household_id}
        profileId={profile.id}
        categories={categories}
        accounts={[]}
      />
    </div>
  );
}
