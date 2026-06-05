'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { useFx } from '@/hooks/useFx';
import { BottomNav } from '@/components/BottomNav';
import { AddTransactionSheet } from '@/components/AddTransactionSheet';
import { DonutChart } from '@/components/DonutChart';
import { MonthlyBars, SingleBars, lastSixMonths } from '@/components/MonthlyBars';
import { netWorthAt, type AccountRow, type AccountTx } from '@/lib/accounts';
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
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fabType, setFabType] = useState<'expense' | 'income'>('expense');
  const [refreshing, setRefreshing] = useState(false);
  // scope: 'me' (Mío) | 'all' (Nuestro) | 'partner' — default to "Mío"
  const [scope, setScope] = useState<'me' | 'all' | 'partner'>('me');
  const scopeProfileId =
    scope === 'me' ? profile.id : scope === 'partner' ? partnerProfileId : undefined;
  const scopeTabs = [
    { key: 'me' as const, label: 'Mío' },
    { key: 'all' as const, label: 'Nuestro' },
    ...(partnerProfileId ? [{ key: 'partner' as const, label: partnerName || 'Pareja' }] : []),
  ];

  const today = new Date();
  const months = lastSixMonths(today);
  const currentKey = months[months.length - 1].key;
  const rangeStart = `${months[0].key}-01`;
  const todayStr = toLocalISO(today);

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('categories')
        .select('id, name, icon, color, kind')
        .eq('household_id', profile.household_id)
        .order('name');
      return data ?? [];
    },
  });

  const { data: txns = [] } = useQuery({
    queryKey: ['transactions', profile.household_id, '6mo-analisis'],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('amount, type, occurred_on, category_id, profile_id, currency, is_shared, scope, splits(payer_profile_id, ower_profile_id, amount)')
        .eq('household_id', profile.household_id)
        .gte('occurred_on', rangeStart);
      return data ?? [];
    },
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

  const { data: accounts = [] } = useQuery<AccountRow[]>({
    queryKey: ['accounts-full', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('accounts')
        .select('id, type, currency, archived, initial_balance, owner_profile_id')
        .eq('household_id', profile.household_id);
      return (data ?? []) as AccountRow[];
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

  const { data: insights = [] } = useQuery({
    queryKey: ['insights', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('insights')
        .select('id, title, body, severity, created_at')
        .eq('household_id', profile.household_id)
        .order('created_at', { ascending: false })
        .limit(4);
      return data ?? [];
    },
  });

  // USD amounts are converted to ARS so charts/totals are in one currency.
  const toArs = (amount: number, currency?: string | null) =>
    currency === 'USD' && arsPerUsd > 0 ? Math.round(amount * arsPerUsd) : amount;

  type Txn = {
    amount: number;
    type: string;
    occurred_on: string;
    category_id: string | null;
    profile_id: string;
    currency: string;
    is_shared: boolean;
    scope: string;
    splits: SplitRow[] | null;
  };
  const allTxns = txns as Txn[];

  // How much of an expense counts for a given person, in ARS. A shared expense
  // is split (each only carries their part, whoever paid); a solo expense counts
  // only for its owner. This mirrors the budgets math so Análisis, Presupuestos
  // and the couple balance all agree on "who spent what".
  const expenseShareArs = (t: Txn, pid: string | undefined): number => {
    if (!pid) return toArs(t.amount, t.currency); // "Nuestro" → combined household
    if (!t.is_shared) return t.profile_id === pid ? toArs(t.amount, t.currency) : 0;
    return myShareArs(t, pid, arsPerUsd);
  };

  // Only count rows up to today, so a future-dated installment doesn't inflate
  // the current month.
  const scopedAccounts = scopeProfileId ? accounts.filter((a) => a.owner_profile_id === scopeProfileId) : accounts;

  // Category breakdown — current month expenses, attributed by share.
  const catById = new Map(categories.map((c) => [c.id, c]));
  const spentByCat = new Map<string, number>();
  for (const t of allTxns) {
    if (t.type !== 'expense' || !t.occurred_on.startsWith(currentKey) || t.occurred_on > todayStr || !t.category_id) continue;
    const share = expenseShareArs(t, scopeProfileId);
    if (share > 0) spentByCat.set(t.category_id, (spentByCat.get(t.category_id) ?? 0) + share);
  }
  const catRows = [...spentByCat.entries()]
    .map(([id, value]) => ({ id, cat: catById.get(id), value }))
    .filter((r) => r.cat && r.value > 0)
    .sort((a, b) => b.value - a.value);
  const monthExpense = catRows.reduce((s, r) => s + r.value, 0);
  const TOP = 6;
  const topCats = catRows.slice(0, TOP);
  const restTotal = catRows.slice(TOP).reduce((s, r) => s + r.value, 0);
  const segments = topCats.map((r, i) => ({
    label: r.cat!.name,
    value: r.value,
    color: r.cat!.color || DONUT_PALETTE[i % DONUT_PALETTE.length],
  }));
  if (restTotal > 0) segments.push({ label: 'Otras', value: restTotal, color: '#C4B9AE' });

  // Subscriptions radar — current-month spend in subscription-type categories.
  // Match by keyword (substring) so variants like "Suscripción" or "Streaming &
  // apps" still count, instead of requiring an exact category name.
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

  // Per-person comparison — each person's current-month *share* (so a shared
  // bill is split, not credited entirely to whoever fronted it). Always across
  // both members, independent of the scope toggle.
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
  const personMax = Math.max(1, ...personRows.map((r) => r.value));

  // 6-month income vs expense. Expenses use each person's share for the scoped
  // view; income isn't shared, so it's attributed to its owner.
  const trendRows = months.map((m) => {
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
    return { ...m, income, expense, rate: income > 0 ? (income - expense) / income : null };
  });

  // 6-month net worth. We only have current balances (initial_balance is a "now"
  // snapshot), so we can't reconstruct net worth for months before there was any
  // activity — those would wrongly show the full balance. Blank them out.
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
      if (!res.ok) throw new Error(`generate-insights ${res.status}`);
      await qc.invalidateQueries({ queryKey: ['insights', profile.household_id] });
      toast.success('Insights actualizados ✓');
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
        {/* Net worth */}
        <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
          <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: '#6B6459' }}>Patrimonio</p>
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

        {/* Spending by category */}
        <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#6B6459' }}>Gastos por categoría</p>
            <span className="text-xs font-black" style={{ color: '#FF7F6B' }}>{formatARS(monthExpense)}</span>
          </div>
          {segments.length === 0 ? (
            <p className="text-sm text-center py-6" style={{ color: '#6B6459' }}>Sin gastos este mes todavía.</p>
          ) : (
            <div className="flex items-center gap-4">
              <div className="shrink-0">
                <DonutChart segments={segments} centerTop="Mes" centerBottom={formatARS(monthExpense)} />
              </div>
              <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                {topCats.map((r, i) => (
                  <Link key={r.id} href={`/categorias/${r.id}`} className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: r.cat!.color || DONUT_PALETTE[i % DONUT_PALETTE.length] }} />
                    <span className="text-xs flex-1 truncate" style={{ color: '#2D2D2D' }}>{r.cat!.icon} {r.cat!.name}</span>
                    <span className="text-xs font-semibold" style={{ color: '#6B6459' }}>{Math.round((r.value / monthExpense) * 100)}%</span>
                    <span className="text-[10px]" style={{ color: '#C4B9AE' }}>›</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 6-month trend */}
        <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
          <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: '#6B6459' }}>Ingresos vs gastos · 6 meses</p>
          <div className="flex items-center gap-4 mb-3 text-[11px]">
            <span className="flex items-center gap-1.5" style={{ color: '#5BA886' }}>
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#7EC8A4' }} /> Ingresos
            </span>
            <span className="flex items-center gap-1.5" style={{ color: '#E5604C' }}>
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#FF7F6B' }} /> Gastos
            </span>
            <span className="ml-auto" style={{ color: '#6B6459' }}>% = ahorro</span>
          </div>
          <MonthlyBars rows={trendRows} />
        </div>

        {/* Per-person comparison */}
        {personRows.length > 1 && (
          <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
            <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: '#6B6459' }}>Quién gastó qué · este mes</p>
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
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#6B6459' }}>Suscripciones · este mes</p>
              <span className="text-xs font-black" style={{ color: '#FF7F6B' }}>{formatARS(subsTotal)}</span>
            </div>
            <div className="flex flex-col gap-2">
              {subRows.map((r) => (
                <Link key={r.cat!.id} href={`/categorias/${r.cat!.id}`} className="flex items-center gap-2">
                  <span className="text-lg">{r.cat!.icon}</span>
                  <span className="text-sm flex-1 truncate" style={{ color: '#2D2D2D' }}>{r.cat!.name}</span>
                  <span className="text-sm font-bold" style={{ color: '#2D2D2D' }}>{formatARS(r.value)}</span>
                  <span className="text-[10px]" style={{ color: '#C4B9AE' }}>›</span>
                </Link>
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
                  <div key={ins.id} className="rounded-2xl p-3 flex items-start gap-2.5" style={{ background: s.bg }}>
                    <span className="text-lg shrink-0">{s.icon}</span>
                    <div className="min-w-0">
                      <p className="font-black text-sm leading-tight" style={{ color: s.color }}>{ins.title}</p>
                      <p className="text-xs mt-0.5 leading-snug" style={{ color: s.color, opacity: 0.85 }}>{ins.body}</p>
                    </div>
                  </div>
                );
              })}
              <Link href="/insights" className="text-xs font-bold text-center pt-1" style={{ color: '#5BA886' }}>
                Ver todos los insights →
              </Link>
            </div>
          )}
        </div>
      </div>

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
