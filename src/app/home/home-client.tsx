'use client';

import { useState, useMemo, useCallback, useEffect, memo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { useFx } from '@/hooks/useFx';
import { usePrivacyStore } from '@/store/privacy';
import { usePushSubscription } from '@/hooks/usePushSubscription';
import {
  myShareArs,
  type BudgetExpenseRow,
} from '@/lib/budgets';
import { BottomNav } from '@/components/BottomNav';
import { AddTransactionSheet } from '@/components/AddTransactionSheet';
import { CoupleBalanceChip } from '@/components/CoupleBalanceChip';
import { InsightTopCard } from '@/components/InsightTopCard';
import { computeProjection } from '@/lib/projection';
import { netWorthAt, type AccountRow, type AccountTx } from '@/lib/accounts';
import { todayISO, weekRange, shortDM, monthKey } from '@/lib/date';
import { useEnvelope } from '@/hooks/useEnvelope';
import { formatARS } from '@/lib/format';
import { triggerBudgetAlerts } from '@/lib/notifyBudgets';

interface Profile {
  id: string;
  household_id: string;
  nickname: string | null;
  display_name: string | null;
}

import Link from 'next/link';

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

// Inline SVG sparkline — no external dep needed
const Sparkline = memo(function Sparkline({ values, positive }: { values: number[]; positive: boolean }) {
  if (values.length < 2) return null;
  const w = 100;
  const h = 36;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  // Inset so the 2px stroke never clips at the top/bottom edges.
  const pad = 3;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = pad + (1 - (v - min) / range) * (h - pad * 2);
      return `${x},${y}`;
    })
    .join(' ');
  // Full-width, fixed-height: stretch horizontally but keep the stroke crisp via
  // vectorEffect so it doesn't get scaled into an uneven thickness.
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      height={h}
      preserveAspectRatio="none"
      className="w-full block"
    >
      <polyline
        points={pts}
        fill="none"
        stroke={positive ? '#7EC8A4' : '#FF7F6B'}
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
});

const IncomeCard = memo(function IncomeCard({
  incomeSoFar,
  expensesSoFar,
  incomeRules,
  fmt,
}: {
  incomeSoFar: number;
  expensesSoFar: number;
  incomeRules: { label: string; amount: number; cadence: string }[];
  fmt: (ars: number) => string;
}) {
  const savingsRate = incomeSoFar > 0 ? (incomeSoFar - expensesSoFar) / incomeSoFar : null;
  const rateColor =
    savingsRate == null ? '#6B6459' : savingsRate >= 0.2 ? '#5BA886' : savingsRate >= 0 ? '#B8860B' : '#E5604C';
  const rateBg =
    savingsRate == null ? '#F0EDE8' : savingsRate >= 0.2 ? '#E4F2EA' : savingsRate >= 0 ? '#FBF1D8' : '#FFE7E2';

  if (incomeSoFar === 0 && incomeRules.length === 0) return null;

  return (
    <div className="mx-4 rounded-3xl p-5 mb-4" style={{ background: '#FFFFFF' }}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: '#6B6459' }}>
            Ingresos del mes
          </p>
          <p className="text-3xl font-black leading-none" style={{ color: '#5BA886', fontVariantNumeric: 'tabular-nums' }}>
            {fmt(incomeSoFar)}
          </p>
        </div>
        {savingsRate != null && (
          <div className="text-right">
            <p className="text-[11px] font-semibold mb-1" style={{ color: '#6B6459' }}>Ahorro</p>
            <span
              className="inline-block text-sm font-black px-2.5 py-1 rounded-full"
              style={{ background: rateBg, color: rateColor }}
            >
              {Math.round(savingsRate * 100)}%
            </span>
          </div>
        )}
      </div>
      {incomeRules.length > 0 && (
        <div className="flex flex-col gap-1.5 pt-3" style={{ borderTop: '1px solid #ECE5DC' }}>
          <p className="text-[11px] font-bold uppercase tracking-wide mb-0.5" style={{ color: '#6B6459' }}>
            Ingresos fijos mensuales
          </p>
          {incomeRules.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-sm shrink-0">💰</span>
              <span className="text-xs flex-1 truncate" style={{ color: '#2D2D2D' }}>{r.label}</span>
              <span className="text-xs font-bold" style={{ color: '#5BA886' }}>+{fmt(r.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

export default function HomeClient({
  profile,
  partnerProfileId,
  partnerName,
}: {
  profile: Profile;
  partnerProfileId?: string;
  partnerName?: string;
}) {
  const supabase = createClient();
  const { format, toggle, showUSD, arsPerUsd, rateStale } = useFx();
  const { hideAmounts, toggle: toggleHide } = usePrivacyStore();
  // Bank-style mask: when the ojito is on, every money value renders as dots.
  const mask = (s: string) => (hideAmounts ? '••••••' : s);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fabType, setFabType] = useState<'expense' | 'income' | 'transfer'>('expense');
  usePushSubscription(profile.id);

  // "Para asignar" (envelope budget) for a quick banner that links to the budget.
  const envBudget = useEnvelope(profile.household_id, profile.id, monthKey());

  // Envelopes that need attention: overspent (red) first, then those under their
  // monthly target (yellow). Replaces the old budgets-table summary on Home.
  const watchEnvelopes = useMemo(() => {
    const catMap = new Map(envBudget.categories.map((c) => [c.id, c]));
    const items: { categoryId: string; available: number; target: number; icon: string; name: string }[] = [];
    for (const r of envBudget.rows) {
      const cat = catMap.get(r.categoryId);
      if (!cat || cat.kind !== 'expense') continue;
      const target = envBudget.targetByCategory.get(r.categoryId) ?? 0;
      if (r.available < 0 || (target > 0 && r.available < target)) {
        items.push({ categoryId: r.categoryId, available: r.available, target, icon: cat.icon, name: cat.name });
      }
    }
    return items
      .sort((a, b) => (a.available < 0 ? 0 : 1) - (b.available < 0 ? 0 : 1) || a.available - b.available)
      .slice(0, 6);
  }, [envBudget.rows, envBudget.categories, envBudget.targetByCategory]);

  // Featured goal ("give your dollars a mission") — chosen in the budget detail.
  const featuredPrefsQ = useQuery({
    queryKey: ['profile-prefs', profile.id],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('notification_prefs').eq('id', profile.id).maybeSingle();
      return (data?.notification_prefs ?? {}) as { featured_category_id?: string };
    },
  });
  const featuredId = featuredPrefsQ.data?.featured_category_id;
  const featured = useMemo(() => {
    if (!featuredId) return null;
    const cat = envBudget.categories.find((c) => c.id === featuredId);
    const info = envBudget.targetInfoByCategory.get(featuredId);
    if (!cat || !info || info.totalArs <= 0) return null;
    return { cat, available: envBudget.rowByCategory.get(featuredId)?.available ?? 0, info };
  }, [featuredId, envBudget.categories, envBudget.targetInfoByCategory, envBudget.rowByCategory]);
  // Re-check budget thresholds once per app open: cron-posted recurring
  // expenses and statement imports move budgets without any client save, so
  // without this their 80%/100% alerts would only fire on the next manual
  // expense. Server-side dedup makes the repeat call harmless.
  useEffect(() => {
    triggerBudgetAlerts(supabase);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // scope: 'all' | 'me' | 'partner' — default to "Mío"
  const [scope, setScope] = useState<'all' | 'me' | 'partner'>('me');
  const name = profile.nickname || profile.display_name || 'Morch';

  const handleFab = useCallback((type: 'expense' | 'income' | 'transfer') => {
    setFabType(type);
    setSheetOpen(true);
  }, []);

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase.from('categories').select('id, name, icon, kind, color, parent_id, is_goal').eq('household_id', profile.household_id).order('name');
      return data ?? [];
    },
    // Categories rarely change; keep them fresh for half an hour.
    staleTime: 1000 * 60 * 30,
  });

  // One accounts query feeds both the net-worth math (needs all accounts incl.
  // archived) and the Add-transaction sheet (only active ones). The sheet's
  // subset is derived below instead of issuing a second query.
  const { data: accountsFull = [] } = useQuery<(AccountRow & { name: string })[]>({
    queryKey: ['accounts-full', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('accounts')
        .select('id, name, type, currency, archived, initial_balance, owner_profile_id, on_budget')
        .eq('household_id', profile.household_id)
        .order('name');
      return (data ?? []) as (AccountRow & { name: string })[];
    },
    staleTime: 1000 * 60 * 30,
  });

  // Active accounts for the sheet dropdown (archived hidden), derived from the
  // single accounts query above.
  const accounts = useMemo(
    () =>
      accountsFull
        .filter((a) => !a.archived)
        .map((a) => ({ id: a.id, name: a.name, type: a.type, owner_profile_id: a.owner_profile_id })),
    [accountsFull],
  );

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

  // Month + week windows. The week (Mon–Sun) can straddle a month edge, so the
  // transaction fetch spans both and each aggregation filters its own window —
  // otherwise the week card silently dropped the days from the previous month.
  const now0 = new Date();
  const monthStart = `${now0.getFullYear()}-${String(now0.getMonth() + 1).padStart(2, '0')}-01`;
  const monthEnd = `${now0.getFullYear()}-${String(now0.getMonth() + 1).padStart(2, '0')}-${String(new Date(now0.getFullYear(), now0.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;
  const week = useMemo(() => weekRange(new Date()), []);
  const rowsStart = week.start < monthStart ? week.start : monthStart;
  const rowsEnd = week.end > monthEnd ? week.end : monthEnd;

  // Load transactions for the current month (plus the week's overhang). Splits
  // ride along so the Mío/Pareja views can count each person's real share of a
  // shared expense instead of charging whoever happened to pay.
  const { data: transactions = [] } = useQuery({
    queryKey: ['transactions', profile.household_id, 'month', rowsStart, rowsEnd],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select(
          'amount, type, occurred_on, profile_id, category_id, currency, scope, is_shared, is_fixed, source, splits(payer_profile_id, ower_profile_id, amount)',
        )
        .eq('household_id', profile.household_id)
        .gte('occurred_on', rowsStart)
        // Cap at month end so a future-month installment cuota doesn't leak into
        // this month's "Gastos" tile, donut and projection.
        .lte('occurred_on', rowsEnd);
      return data ?? [];
    },
  });


  // Load active recurring rules
  const { data: rules = [] } = useQuery({
    queryKey: ['recurring_rules', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('recurring_rules')
        .select('direction, amount, next_run, active, profile_id, label, cadence, currency')
        .eq('household_id', profile.household_id)
        .eq('active', true)
        // Goal contributions move money into a goal, not out of the pocket: keep them out of cash flow.
        .is('goal_id', null);
      return data ?? [];
    },
  });

  const scopeProfileId =
    scope === 'me' ? profile.id : scope === 'partner' ? partnerProfileId : undefined;

  // Normalize every amount to ARS (USD × blue rate) so one currency flows through
  // the projection and all the home totals. useFx's format() then renders it in
  // the active currency, so a USD income never shows up as "$" pesos.
  const toArs = useCallback(
    (amount: number, currency?: string | null) =>
      currency === 'USD' && arsPerUsd > 0 ? Math.round(amount * arsPerUsd) : amount,
    [arsPerUsd],
  );

  const txArs = useMemo(
    () => transactions.map((t) => ({ ...t, amount: toArs(t.amount, t.currency as string | null) })),
    [transactions, toArs],
  );
  const rulesArs = useMemo(
    () => rules.map((r) => ({ ...r, amount: toArs(r.amount, r.currency as string | null) })),
    [rules, toArs],
  );

  // Month-end projection — O(days × rules); only recompute when the inputs or
  // the active scope change, not on every unrelated render.
  const projection = useMemo(
    () =>
      computeProjection(
        txArs.map((t) => ({
          type: t.type as 'income' | 'expense' | 'transfer',
          amount: t.amount,
          occurred_on: t.occurred_on,
          profile_id: t.profile_id,
        })),
        rulesArs.map((r) => ({
          direction: r.direction as 'income' | 'expense',
          amount: r.amount,
          next_run: r.next_run,
          active: r.active,
          profile_id: r.profile_id,
          cadence: r.cadence as 'weekly' | 'biweekly' | 'monthly' | undefined,
        })),
        new Date(),
        scopeProfileId,
      ),
    [txArs, rulesArs, scopeProfileId],
  );

  const {
    projectedBalance,
    incomeSoFar,
    expensesSoFar,
    dailyBalances,
    currentBalance,
    remainingIncome,
    remainingFixedExpenses,
    projectedVariableSpend,
    daysRemaining,
    daysElapsed,
  } = projection;
  const isPositive = projectedBalance >= 0;
  const accent = isPositive ? '#5BA886' : '#E5604C';
  // Everything still to leave the account this month: fixed (rules) + the
  // variable spend extrapolated from the month's pace so far.
  const remainingSpend = remainingFixedExpenses + projectedVariableSpend;
  const dailyRate = daysElapsed > 0 ? Math.round(expensesSoFar / daysElapsed) : 0;

  const incomeRules = useMemo(
    () =>
      rulesArs
        .filter((r) => r.direction === 'income' && (!scopeProfileId || r.profile_id === scopeProfileId))
        .map((r) => ({ label: (r.label as string) ?? 'Ingreso', amount: r.amount, cadence: (r.cadence as string) ?? 'monthly' })),
    [rulesArs, scopeProfileId],
  );

  // Quick-access tile values. The Cuentas total respects the scope: in "Mío" it
  // only counts my accounts, in "Nuestro" it counts both.
  const totalBalance = useMemo(() => {
    const scoped = scopeProfileId
      ? accountsFull.filter((a) => a.owner_profile_id === scopeProfileId)
      : accountsFull;
    return netWorthAt(scoped, accountTx, todayISO(), arsPerUsd);
  }, [accountsFull, accountTx, scopeProfileId, arsPerUsd]);
  const balColor = totalBalance >= 0 ? '#5BA886' : '#E5604C';

  // Scope-aware expense aggregations (respect the Nuestro/Mío/Pareja toggle) for
  // the donut, the "Gastos" tile and the week card — computed once per change.
  // In Mío/Pareja a shared expense counts as that person's SHARE (via the
  // split), no matter who fronted the money — the same rule the budget cards
  // and the budgets page use. "Nuestro" counts every expense once, in full.
  const { monthExpenseTotal, weekExpenseTotal, weekFixedTotal } = useMemo(() => {
    const shareOf = (t: (typeof transactions)[number]): number => {
      if (!scopeProfileId) return toArs(t.amount, t.currency as string | null);
      const row = t as unknown as BudgetExpenseRow;
      if (row.is_shared) return myShareArs(row, scopeProfileId, arsPerUsd);
      return t.profile_id === scopeProfileId ? toArs(t.amount, t.currency as string | null) : 0;
    };
    // Fixed expenses (manually flagged or materialized from a recurring rule)
    // don't count against the weekly total limit — only against budgets/totals.
    const isFixed = (t: (typeof transactions)[number]): boolean =>
      (t as { is_fixed?: boolean }).is_fixed === true || (t as { source?: string }).source === 'recurring';
    let monthTotal = 0;
    let weekTotal = 0;
    let weekFixed = 0;
    for (const t of transactions) {
      if (t.type !== 'expense') continue;
      const amt = shareOf(t);
      if (amt <= 0) continue;
      if (t.occurred_on >= monthStart && t.occurred_on <= monthEnd) {
        monthTotal += amt;
      }
      if (t.occurred_on >= week.start && t.occurred_on <= week.end) {
        weekTotal += amt;
        if (isFixed(t)) weekFixed += amt;
      }
    }
    return { monthExpenseTotal: monthTotal, weekExpenseTotal: weekTotal, weekFixedTotal: weekFixed };
  }, [transactions, scopeProfileId, week, toArs, arsPerUsd, monthStart, monthEnd]);
  // Discretionary spend that counts against the weekly limit = total minus fixed.
  const weekVariableTotal = weekExpenseTotal - weekFixedTotal;
  // Savings rate: my income vs MY SHARE of the month's expenses (consistent
  // with the tiles above and the Ahorro page), not just what I fronted.
  const savingsRate = incomeSoFar > 0 ? Math.round(((incomeSoFar - monthExpenseTotal) / incomeSoFar) * 100) : null;


  // Envelope mode has no weekly spending limit; the week card just shows the
  // pace (variable vs fixed), not a limit bar.
  const weeklyLimitArs: number | null = null;
  // The limit measures discretionary spend, so compare it against the variable
  // total (fixed expenses excluded), not the full week's spend.
  const weekPct = weeklyLimitArs && weeklyLimitArs > 0 ? weekVariableTotal / weeklyLimitArs : null;
  const weekBarColor = weekPct == null ? '#FF7F6B' : weekPct >= 1 ? '#FF7F6B' : weekPct >= 0.8 ? '#F5A623' : '#7EC8A4';

  const quickTiles = [
    { href: '/cuentas', icon: '🏦', label: 'Cuentas', value: mask(format(totalBalance)), color: totalBalance < 0 ? '#E5604C' : '#2D2D2D' },
    { href: '/analisis', icon: '💸', label: 'Gastos', value: mask(format(monthExpenseTotal)), color: '#FF7F6B' },
    { href: '/reglas', icon: '💰', label: 'Ingresos', value: mask(format(incomeSoFar)), color: '#5BA886' },
    { href: '/ahorro', icon: '🐷', label: 'Ahorro', value: savingsRate == null ? '—' : `${savingsRate}%`, color: '#B8860B' },
  ];

  const greetingHour = new Date().getHours();
  const greeting = greetingHour < 12 ? 'Buenos días' : greetingHour < 19 ? 'Buenas tardes' : 'Buenas noches';

  const scopeTabs = [
    { key: 'me' as const, label: 'Mío' },
    { key: 'all' as const, label: 'Nuestro' },
    ...(partnerProfileId ? [{ key: 'partner' as const, label: partnerName || 'Pareja' }] : []),
  ];

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F9F5F0' }}>
      {/* Header */}
      <header className="flex items-center justify-between px-5 pt-14 pb-4">
        <div>
          <p className="text-sm" style={{ color: '#6B6459' }}>{greeting},</p>
          <h1 className="text-2xl font-black" style={{ color: '#2D2D2D' }}>{name} 👋</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleHide}
            aria-label={hideAmounts ? 'Mostrar importes' : 'Ocultar importes'}
            className="flex items-center justify-center w-9 h-9 rounded-full border"
            style={{ borderColor: '#7EC8A4', color: '#7EC8A4' }}
          >
            {hideAmounts ? <EyeOffIcon /> : <EyeIcon />}
          </button>
          <button
            onClick={toggle}
            className="text-sm font-bold px-3 py-1.5 rounded-full border"
            style={{ borderColor: '#7EC8A4', color: '#7EC8A4' }}
          >
            {showUSD ? 'USD' : 'ARS'}
          </button>
        </div>
      </header>

      {/* Scope toggle */}
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

      {/* Stale FX warning — USD conversions are approximate until the rate refreshes */}
      {rateStale && (
        <div className="mx-4 mb-3 rounded-2xl px-4 py-2.5 flex items-center gap-2" style={{ background: '#FDF1D8' }}>
          <span>⚠️</span>
          <p className="text-[11px] font-semibold" style={{ color: '#B8860B' }}>
            Cotización del dólar desactualizada — los montos en USD son aproximados.
          </p>
        </div>
      )}

      {/* Hero: real money available right now — the concrete number, shown first.
          The forward-looking estimate lives in the projection card below. */}
      <Link
        href="/cuentas"
        className="mx-4 rounded-3xl p-5 shadow-sm mb-4 block animate-in fade-in duration-500"
        style={{ background: totalBalance >= 0 ? '#E4F2EA' : '#FFE7E2' }}
      >
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs font-bold uppercase tracking-wide" style={{ color: balColor }}>
            Disponible hoy
          </p>
          <span className="text-xs font-semibold" style={{ color: balColor, opacity: 0.75 }}>Cuentas ›</span>
        </div>
        <p
          className="text-[clamp(2rem,10vw,2.75rem)] font-black leading-none mb-1"
          style={{ color: balColor, fontVariantNumeric: 'tabular-nums' }}
        >
          {hideAmounts
            ? '••••••'
            : `${totalBalance < 0 ? '−' : ''}${showUSD && arsPerUsd > 0
                ? `US$${Math.round(Math.abs(totalBalance) / arsPerUsd).toLocaleString('es-AR')}`
                : formatARS(Math.abs(totalBalance))}`}
        </p>
        <p className="text-xs" style={{ color: balColor, opacity: 0.75 }}>
          {hideAmounts
            ? ''
            : showUSD
              ? (totalBalance < 0 ? '−' : '') + formatARS(Math.abs(totalBalance))
              : arsPerUsd > 0
                ? `≈ US$${Math.round(Math.abs(totalBalance) / arsPerUsd).toLocaleString('es-AR')}`
                : ''}
        </p>
      </Link>

      {/* Projection card — secondary: a forward-looking estimate, on a plain
          card so it reads as support to the real balance above. */}
      <div className="mx-4 rounded-3xl p-5 mb-4 animate-in fade-in duration-500" style={{ background: '#FFFFFF' }}>
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#6B6459' }}>
            Si seguís así, fin de mes
          </p>
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: isPositive ? '#5BA88622' : '#E5604C22', color: accent }}
          >
            estimado
          </span>
        </div>

        {/* Projected balance — full width so a long amount can't overflow into the chart */}
        <p
          className="text-[clamp(1.5rem,8vw,2rem)] font-black leading-none mb-1"
          style={{ color: accent, fontVariantNumeric: 'tabular-nums' }}
        >
          {hideAmounts
            ? '••••••'
            : `${!isPositive ? '−' : ''}${showUSD && arsPerUsd > 0
                ? `US$${Math.round(Math.abs(projectedBalance) / arsPerUsd).toLocaleString('es-AR')}`
                : formatARS(Math.abs(projectedBalance))}`}
        </p>
        <p className="text-xs" style={{ color: accent, opacity: 0.75 }}>
          {hideAmounts
            ? ''
            : showUSD
              ? (!isPositive ? '−' : '') + formatARS(Math.abs(projectedBalance))
              : arsPerUsd > 0
                ? `≈ US$${Math.round(Math.abs(projectedBalance) / arsPerUsd).toLocaleString('es-AR')}`
                : ''}
        </p>

        {/* Full-width trend of the projected daily balance */}
        <div className="mt-3">
          <Sparkline values={dailyBalances} positive={isPositive} />
        </div>

        {/* How we got there — these three add up to the projection above:
            saldo hoy + por entrar − por gastar */}
        <div className="grid grid-cols-3 gap-2 mt-3 pt-3" style={{ borderTop: `1px solid ${accent}33` }}>
          <div>
            <p className="text-[11px]" style={{ color: accent, opacity: 0.75 }}>Saldo hoy</p>
            <p className="text-sm font-bold" style={{ color: accent }}>{mask(format(currentBalance))}</p>
          </div>
          <div>
            <p className="text-[11px]" style={{ color: accent, opacity: 0.75 }}>+ Por entrar</p>
            <p className="text-sm font-bold" style={{ color: accent }}>{mask(format(remainingIncome))}</p>
          </div>
          <div>
            <p className="text-[11px]" style={{ color: accent, opacity: 0.75 }}>− Por gastar</p>
            <p className="text-sm font-bold" style={{ color: accent }}>{mask(format(remainingSpend))}</p>
          </div>
        </div>

        {/* Plain-language explanation of where the estimate comes from */}
        {incomeSoFar === 0 && expensesSoFar === 0 ? (
          <p className="text-[11px] mt-3" style={{ color: accent }}>
            Todavía no hay movimientos este mes. Tocá + para registrar un ingreso o gasto.
          </p>
        ) : (
          <p className="text-[11px] mt-3 leading-relaxed" style={{ color: accent, opacity: 0.75 }}>
            Saldo de hoy más lo que falta entrar, menos lo que falta gastar. El gasto
            variable se proyecta a tu ritmo (~{mask(format(dailyRate))}/día) por los{' '}
            {daysRemaining} días que quedan{remainingFixedExpenses > 0 ? ', sumando tus gastos fijos pendientes' : ''}.
          </p>
        )}
      </div>

      {/* Quick-access tiles */}
      <div className="mx-4 mb-4 grid grid-cols-4 gap-2 animate-in fade-in duration-500">
        {quickTiles.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="rounded-2xl px-2 py-3 flex flex-col items-center gap-1 text-center"
            style={{ background: '#FFFFFF' }}
          >
            <span className="text-2xl">{t.icon}</span>
            <span className="text-[10px] font-semibold" style={{ color: '#6B6459' }}>{t.label}</span>
            <span className="text-[11px] font-black leading-tight truncate w-full" style={{ color: t.color, fontVariantNumeric: 'tabular-nums' }}>
              {t.value}
            </span>
          </Link>
        ))}
      </div>

      {/* This week's spend (Mon–Sun) — tap to see the week's movements. When a
          weekly TOTAL limit exists for the active scope, the card becomes a
          progress bar against it. */}
      <Link
        href="/movimientos?range=week"
        className="mx-4 mb-4 block px-5 py-4 rounded-3xl"
        style={{ background: '#FFFFFF' }}
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">📆</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#6B6459' }}>Gastos de la semana</p>
            <p className="text-[11px]" style={{ color: '#6B6459' }}>Lun {shortDM(week.start)} – Dom {shortDM(week.end)}</p>
          </div>
          <p className="text-xl font-black flex-shrink-0" style={{ color: weeklyLimitArs ? weekBarColor : '#FF7F6B', fontVariantNumeric: 'tabular-nums' }}>
            {mask(format(weekExpenseTotal))}
          </p>
          <span className="text-xs flex-shrink-0" style={{ color: '#C4B9AE' }}>›</span>
        </div>
        {weeklyLimitArs != null && weekPct != null && (
          <div className="mt-3">
            <div className="h-2.5 rounded-full overflow-hidden" style={{ background: '#ECE5DC' }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ background: weekBarColor, width: `${Math.min(weekPct * 100, 100)}%` }}
              />
            </div>
            <div className="flex justify-between mt-1">
              <p className="text-[11px] font-semibold" style={{ color: weekBarColor }}>
                {weekPct >= 1 ? 'Límite semanal superado' : `${Math.round(weekPct * 100)}% del límite semanal`}
              </p>
              <p className="text-[11px]" style={{ color: weekPct >= 1 ? '#FF7F6B' : '#6B6459' }}>
                {weekPct >= 1
                  ? `+${mask(formatARS(weekVariableTotal - weeklyLimitArs))} excedido`
                  : `quedan ${mask(formatARS(weeklyLimitArs - weekVariableTotal))}`}
              </p>
            </div>
            {weekFixedTotal > 0 && (
              <p className="text-[11px] mt-1" style={{ color: '#6B6459' }}>
                📌 {mask(formatARS(weekFixedTotal))} en fijos no cuentan para el límite
              </p>
            )}
          </div>
        )}
      </Link>

      {/* Income of the month + savings rate (expenses = my share, like the tiles) */}
      <IncomeCard incomeSoFar={incomeSoFar} expensesSoFar={monthExpenseTotal} incomeRules={incomeRules} fmt={(n) => mask(format(n))} />

      {/* Couple balance chip */}
      <CoupleBalanceChip
        householdId={profile.household_id}
        myProfileId={profile.id}
        partnerProfileId={partnerProfileId}
        partnerName={partnerName}
      />

      {/* AI insight card */}
      <InsightTopCard householdId={profile.household_id} profileId={profile.id} />

      {/* "Para asignar" — quick link to the envelope budget (the heart of the app) */}
      <Link
        href="/presupuestos"
        className="block mx-4 mb-4 rounded-3xl p-5"
        style={{ background: envBudget.readyToAssign >= 0 ? '#E4F2EA' : '#FFE7E2' }}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#6B6459' }}>Para asignar</p>
            <p className="text-2xl font-black" style={{ color: envBudget.readyToAssign > 0 ? '#5BA886' : envBudget.readyToAssign < 0 ? '#E5604C' : '#6B6459' }}>
              {mask(format(envBudget.readyToAssign))}
            </p>
          </div>
          <span className="text-sm font-bold" style={{ color: '#5BA886' }}>Ir al presupuesto ›</span>
        </div>
      </Link>

      {/* Featured goal — "give your dollars a mission" */}
      {featured && (
        <Link href="/presupuestos" className="block mx-4 mb-4 rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#6B6459' }}>Meta destacada</p>
            <span className="text-xs font-bold" style={{ color: '#5B8DEF' }}>Ajustar ›</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="relative w-20 h-20 shrink-0">
              <svg viewBox="0 0 36 36" className="w-20 h-20 -rotate-90">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#ECE5DC" strokeWidth="3.5" />
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#7EC8A4" strokeWidth="3.5" strokeDasharray={`${featured.info.pctComplete * 100} 100`} strokeLinecap="round" />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-sm font-black" style={{ color: '#2D2D2D' }}>{Math.round(featured.info.pctComplete * 100)}%</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-base font-black truncate" style={{ color: '#2D2D2D' }}>{featured.cat.icon} {featured.cat.name}</p>
              <div className="flex gap-5 mt-1.5">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: '#6B6459' }}>Saldo actual</p>
                  <p className="text-sm font-black tabular-nums" style={{ color: '#5BA886' }}>{mask(format(featured.available))}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: '#6B6459' }}>Falta</p>
                  <p className="text-sm font-black tabular-nums" style={{ color: '#2D2D2D' }}>{mask(format(Math.max(0, featured.info.totalArs - featured.available)))}</p>
                </div>
              </div>
            </div>
          </div>
        </Link>
      )}

      {/* Sobres a vigilar — overspent / under-target envelopes from the budget */}
      {watchEnvelopes.length > 0 ? (
        <div className="mx-4 rounded-3xl p-5 mb-4" style={{ background: '#FFFFFF' }}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#6B6459' }}>Sobres a vigilar</p>
            <Link href="/presupuestos" className="text-xs font-bold" style={{ color: '#5BA886' }}>Ver todos ›</Link>
          </div>
          <div className="flex flex-col gap-2.5">
            {watchEnvelopes.map((w) => {
              const overspent = w.available < 0;
              const fg = overspent ? '#E5604C' : '#C79A2B';
              const bg = overspent ? '#FFE7E2' : '#FBF0D6';
              return (
                <Link key={w.categoryId} href="/presupuestos" className="flex items-center gap-3">
                  <span className="text-lg shrink-0">{w.icon}</span>
                  <span className="flex-1 min-w-0 text-sm font-semibold truncate" style={{ color: '#2D2D2D' }}>{w.name}</span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ background: bg, color: fg }}>
                    {overspent ? `Sobregiraste ${mask(formatARS(-w.available))}` : `Faltan ${mask(formatARS(w.target - w.available))}`}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      ) : (
        <Link href="/presupuestos" className="block mx-4 rounded-3xl p-5 mb-4 text-center" style={{ background: '#FFFFFF' }}>
          <p className="text-sm font-semibold" style={{ color: '#5BA886' }}>Todos tus sobres en orden 🎉</p>
        </Link>
      )}

      <BottomNav onFab={handleFab} />

      <AddTransactionSheet
        open={sheetOpen}
        initialType={fabType}
        onClose={() => setSheetOpen(false)}
        householdId={profile.household_id}
        profileId={profile.id}
        partnerProfileId={partnerProfileId}
        categories={categories}
        accounts={accounts}
      />
    </div>
  );
}
