'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { toast } from 'sonner';
import { useFx } from '@/hooks/useFx';
import { AddTransactionSheet } from '@/components/AddTransactionSheet';
import { ReceiptItemsSheet } from '@/components/ReceiptItemsSheet';
import { BottomNav } from '@/components/BottomNav';
import { EmptyState } from '@/components/EmptyState';
import { SwipeAction } from '@/components/SwipeAction';
import { UpcomingStrip } from '@/components/UpcomingStrip';
import { useHaptics } from '@/hooks/useHaptics';
import { exportTransactionsToCSV } from '@/lib/csvExport';
import { formatARS } from '@/lib/format';
import { ChartTooltip } from '@/components/ChartTooltip';
import { FLAG_COLORS, flagHex } from '@/lib/flags';
import { todayISO, weekRange, shortDM } from '@/lib/date';
import { normalizeText } from '@/lib/text';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from 'recharts';

interface Profile {
  id: string;
  household_id: string;
  nickname: string | null;
  display_name: string | null;
}

interface MovimientosClientProps {
  profile: Profile;
  partnerProfileId?: string;
}

type Tx = {
  id: string;
  amount: number;
  type: string;
  currency: string;
  category_id: string | null;
  account_id: string | null;
  transfer_account_id: string | null;
  scope: string;
  is_shared: boolean;
  is_fixed: boolean;
  exclude_from_stats: boolean;
  cleared: boolean;
  flag: string | null;
  merchant: string | null;
  occurred_on: string;
  profile_id: string;
  source: string | null;
  installment_number: number | null;
  installment_total: number | null;
  categories: { name: string; icon: string } | null;
};

export default function MovimientosClient({ profile, partnerProfileId }: MovimientosClientProps) {
  const supabase = createClient();
  const { format, secondary, toggle, showUSD, arsPerUsd } = useFx();
  const haptic = useHaptics();
  // Normalize a stored amount to ARS so USD and ARS movements aggregate together;
  // format()/secondary() then render it in the active display currency.
  const toArs = useCallback(
    (amount: number, currency: string) =>
      currency === 'USD' && arsPerUsd > 0 ? Math.round(amount * arsPerUsd) : amount,
    [arsPerUsd],
  );
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fabType, setFabType] = useState<'expense' | 'income' | 'transfer'>('expense');
  const [editTx, setEditTx] = useState<Tx | null>(null);
  const [search, setSearch] = useState('');
  // Debounced copy of the search box (~250ms): filtering — and the widened
  // fetch below — follow this so we don't refetch/refilter on every keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);
  const [filterScope, setFilterScope] = useState<'all' | 'personal' | 'household'>('all');
  const [filterShared, setFilterShared] = useState<boolean | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  // Date range: defaults from the ?range= query param (e.g. Home's "Gastos de
  // la semana" links here with range=week).
  const [filterRange, setFilterRange] = useState<'all' | 'week' | 'month'>(() => {
    if (typeof window === 'undefined') return 'all';
    const r = new URLSearchParams(window.location.search).get('range');
    return r === 'week' || r === 'month' ? r : 'all';
  });
  const [showChart, setShowChart] = useState(false);
  // Advanced filters + bulk-select mode.
  // Account filter: defaults from ?account= (e.g. /cuentas links here to open one
  // account's register, with its running balance + reconcile).
  const [filterAccount, setFilterAccount] = useState<string>(() => {
    if (typeof window === 'undefined') return 'all';
    return new URLSearchParams(window.location.search).get('account') || 'all';
  });
  const [filterMinAmount, setFilterMinAmount] = useState<number>(0);
  const [filterFixed, setFilterFixed] = useState<boolean | null>(null);
  const [filterFlag, setFilterFlag] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCatOpen, setBulkCatOpen] = useState(false);

  const week = weekRange(new Date());
  const monthPrefix = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  function inRange(occurredOn: string): boolean {
    if (filterRange === 'week') return occurredOn >= week.start && occurredOn <= week.end;
    if (filterRange === 'month') return occurredOn.startsWith(monthPrefix);
    return true;
  }

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('categories')
        .select('id, name, icon, kind, color, parent_id, is_goal')
        .eq('household_id', profile.household_id)
        .order('name');
      return data ?? [];
    },
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts-mov', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('accounts')
        .select('id, name, type, currency, owner_profile_id, initial_balance, reconciled_balance, last_reconciled_at')
        .eq('household_id', profile.household_id)
        .eq('archived', false)
        .order('name');
      return data ?? [];
    },
  });

  // One fetch, one cache key. The Semana/Mes/Histórico chips, the text search
  // and the per-account register are all *client-side* filters (see inRange and
  // `filtered` below), so the data layer must hand them the same full set every
  // time. We used to split the cache by range ('recent' vs 'all', date-bounded),
  // but the two entries expired independently (staleTime 5 min, no focus
  // refetch), so a just-added movement could surface under Semana while its
  // older Histórico snapshot still hid it — Histórico is meant to be a strict
  // superset. The row limit stays as a backstop, never as the primary cutoff.
  const searchActive = debouncedSearch.trim().length > 0;
  const { data: transactions = [] } = useQuery<Tx[]>({
    queryKey: ['transactions', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('id, amount, type, currency, category_id, account_id, transfer_account_id, scope, is_shared, is_fixed, exclude_from_stats, cleared, flag, merchant, occurred_on, profile_id, source, installment_number, installment_total, categories:category_id(name, icon)')
        .eq('household_id', profile.household_id)
        .order('occurred_on', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1000);
      return (data as Tx[]) ?? [];
    },
  });

  // Which transactions actually have scanned line-items, so we only badge the
  // ones whose detail is worth opening (a single-charge receipt has none). One
  // light query of just the FK column, deduped into a Set client-side.
  const { data: itemTxIds = new Set<string>() } = useQuery<Set<string>>({
    queryKey: ['transaction-item-ids', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('transaction_items')
        .select('transaction_id')
        .eq('household_id', profile.household_id);
      return new Set((data ?? []).map((r) => r.transaction_id as string));
    },
  });

  // Per-purchase detail (scanned products) for a tapped movement.
  const [itemsTx, setItemsTx] = useState<Tx | null>(null);

  // Visibility rule: each user only sees their own personal movements plus the
  // shared household ones. The partner's personal movements never show here.
  const visibleTransactions = useMemo(
    () => transactions.filter((tx) => tx.scope === 'household' || tx.profile_id === profile.id),
    [transactions, profile.id],
  );

  // Structural filters (scope / shared / range) but NOT the text search nor the
  // single-category drilldown. The month summary, the chart and the per-category
  // breakdown build on this so they react to the scope you picked while staying
  // month-based even when a search is active.
  const scopeFiltered = useMemo(() => {
    return visibleTransactions.filter((tx) => {
      if (filterScope !== 'all' && tx.scope !== filterScope) return false;
      if (filterShared !== null && tx.is_shared !== filterShared) return false;
      if (!inRange(tx.occurred_on)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleTransactions, filterScope, filterShared, filterRange]);

  // Text search over merchant/description and category name, accent-insensitive.
  // While searching, the date-range chip is ignored so the whole visible history
  // is searchable (the fetch above widens accordingly).
  const searched = useMemo(() => {
    if (!searchActive) return scopeFiltered;
    const q = normalizeText(debouncedSearch.trim());
    return visibleTransactions.filter((tx) => {
      if (filterScope !== 'all' && tx.scope !== filterScope) return false;
      if (filterShared !== null && tx.is_shared !== filterShared) return false;
      return (
        normalizeText(tx.merchant ?? '').includes(q) ||
        normalizeText(tx.categories?.name ?? '').includes(q)
      );
    });
  }, [searchActive, scopeFiltered, visibleTransactions, debouncedSearch, filterScope, filterShared]);

  const filtered = useMemo(
    () =>
      searched.filter((tx) => {
        if (filterCategory !== 'all' && tx.category_id !== filterCategory) return false;
        if (filterAccount !== 'all' && tx.account_id !== filterAccount && tx.transfer_account_id !== filterAccount) return false;
        if (filterFixed === true && !tx.is_fixed) return false;
        if (filterFlag && tx.flag !== filterFlag) return false;
        if (filterMinAmount > 0 && toArs(tx.amount, tx.currency) < filterMinAmount) return false;
        return true;
      }),
    [searched, filterCategory, filterAccount, filterFixed, filterFlag, filterMinAmount, toArs],
  );

  // Running balance per tx for a single selected account (statement-style).
  const runningBalance = useMemo(() => {
    if (filterAccount === 'all') return null;
    const acc = accounts.find((a) => a.id === filterAccount);
    if (!acc) return null;
    const rows = transactions
      .filter((t) => t.account_id === filterAccount || (t.type === 'transfer' && t.transfer_account_id === filterAccount))
      .sort((a, b) => a.occurred_on.localeCompare(b.occurred_on) || (a.id < b.id ? -1 : 1));
    const map = new Map<string, number>();
    let bal = (acc as { initial_balance?: number }).initial_balance ?? 0;
    for (const t of rows) {
      if (t.account_id === filterAccount) {
        if (t.type === 'income') bal += t.amount;
        else bal -= t.amount; // expense or transfer-out
      } else {
        bal += t.amount; // transfer-in (destination)
      }
      map.set(t.id, bal);
    }
    return map;
  }, [filterAccount, accounts, transactions]);

  // Cleared balance = initial + only the cleared transactions, for reconciliation.
  const selectedAccount = filterAccount === 'all' ? null : accounts.find((a) => a.id === filterAccount) ?? null;
  const clearedBalance = useMemo(() => {
    if (!selectedAccount) return null;
    let bal = (selectedAccount as { initial_balance?: number }).initial_balance ?? 0;
    for (const t of transactions) {
      if (!t.cleared) continue;
      if (t.account_id === filterAccount) bal += t.type === 'income' ? t.amount : -t.amount;
      else if (t.type === 'transfer' && t.transfer_account_id === filterAccount) bal += t.amount;
    }
    return Math.round(bal);
  }, [selectedAccount, filterAccount, transactions]);

  // After reconciling, cleared transactions up to that date are locked.
  const reconciledCutoff = (selectedAccount as { last_reconciled_at?: string | null } | null)?.last_reconciled_at?.slice(0, 10) ?? null;
  const isLocked = (tx: Tx) => tx.cleared && reconciledCutoff != null && tx.occurred_on <= reconciledCutoff;

  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [bankBal, setBankBal] = useState('');
  async function toggleCleared(tx: Tx) {
    const { error } = await supabase.from('transactions').update({ cleared: !tx.cleared }).eq('id', tx.id);
    if (error) { toast.error('No se pudo actualizar'); return; }
    qc.invalidateQueries({ queryKey: ['transactions'] });
  }
  async function doReconcile() {
    if (!selectedAccount || clearedBalance == null) return;
    const bank = Number(bankBal);
    if (!Number.isFinite(bank) || bankBal.trim() === '') { toast.error('Ingresá el saldo del banco'); return; }
    const diff = Math.round(bank - clearedBalance);
    if (diff !== 0) {
      const { error: e1 } = await supabase.from('transactions').insert({
        household_id: profile.household_id,
        profile_id: profile.id,
        account_id: filterAccount,
        type: diff > 0 ? 'income' : 'expense',
        amount: Math.abs(diff),
        currency: (selectedAccount as { currency?: string }).currency ?? 'ARS',
        occurred_on: todayISO(),
        merchant: 'Ajuste de conciliación',
        cleared: true,
        scope: 'personal',
      });
      if (e1) { toast.error('No se pudo crear el ajuste'); return; }
    }
    const { error: e2 } = await supabase.from('accounts').update({ reconciled_balance: bank, last_reconciled_at: new Date().toISOString() }).eq('id', filterAccount);
    if (e2) { toast.error('No se pudo conciliar'); return; }
    toast.success(diff === 0 ? '¡Conciliado! Todo cuadra. ✓' : `Conciliado · ajuste de ${formatARS(Math.abs(diff))}`);
    setReconcileOpen(false);
    setBankBal('');
    qc.invalidateQueries({ queryKey: ['transactions'] });
    qc.invalidateQueries({ queryKey: ['accounts-mov'] });
    qc.invalidateQueries({ queryKey: ['envelope-tx'] });
  }

  const grouped = useMemo(() => {
    const map = new Map<string, Tx[]>();
    for (const tx of filtered) {
      const arr = map.get(tx.occurred_on) ?? [];
      arr.push(tx);
      map.set(tx.occurred_on, arr);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  function fmtDate(d: string) {
    return new Date(d + 'T00:00:00').toLocaleDateString('es-AR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  }

  // The summary cards stay month-based and don't react to the text search:
  // build on scopeFiltered (search-free) with only the category drilldown on top.
  const monthSummary = useMemo(() => {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const base =
      filterCategory === 'all'
        ? scopeFiltered
        : scopeFiltered.filter((tx) => tx.category_id === filterCategory);
    const current = base.filter((tx) => tx.occurred_on.startsWith(month));
    const expenses = current.filter((tx) => tx.type === 'expense' && !tx.exclude_from_stats).reduce((s, tx) => s + toArs(tx.amount, tx.currency), 0);
    const income = current.filter((tx) => tx.type === 'income' && !tx.exclude_from_stats).reduce((s, tx) => s + toArs(tx.amount, tx.currency), 0);
    return { expenses, income };
  }, [scopeFiltered, filterCategory, toArs]);

  // Chart data: top 5 categories current vs previous month
  const chartData = useMemo(() => {
    const now = new Date();
    const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

    const curMap = new Map<string, number>();
    const prevMap = new Map<string, number>();

    for (const tx of scopeFiltered) {
      if (tx.type !== 'expense' || tx.exclude_from_stats) continue;
      const id = tx.category_id ?? '__none__';
      if (tx.occurred_on.startsWith(curMonth)) {
        curMap.set(id, (curMap.get(id) ?? 0) + toArs(tx.amount, tx.currency));
      } else if (tx.occurred_on.startsWith(prevMonth)) {
        prevMap.set(id, (prevMap.get(id) ?? 0) + toArs(tx.amount, tx.currency));
      }
    }

    // rank by current month
    const sorted = [...curMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));

    return sorted.map(([id, cur]) => ({
      name: catMap[id]?.icon ? `${catMap[id].icon} ${catMap[id].name}` : 'Sin cat.',
      'Este mes': cur,
      'Mes anterior': prevMap.get(id) ?? 0,
    }));
  }, [scopeFiltered, categories, toArs]);

  function handleExport() {
    const filename = `movimientos-${todayISO()}.csv`;
    exportTransactionsToCSV(filtered, filename);
  }

  const acctName = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? '—';

  // Bulk actions on the selected rows.
  const qc = useQueryClient();
  const invalidateMoney = () => {
    qc.invalidateQueries({ queryKey: ['transactions'] });
    qc.invalidateQueries({ queryKey: ['envelope-tx'] });
    qc.invalidateQueries({ queryKey: ['envelope'] });
  };
  // Single-row delete, fired by the swipe-left gesture. Splits have no ON DELETE
  // CASCADE, so clear them before the parent row (same order as the sheet's own
  // delete). Only this row is removed — other cuotas of a plan stay.
  async function deleteTx(tx: Tx) {
    if (!window.confirm('¿Borrar este movimiento? No se puede deshacer.')) return;
    haptic('warning');
    await supabase.from('splits').delete().eq('transaction_id', tx.id);
    const { error } = await supabase.from('transactions').delete().eq('id', tx.id);
    if (error) { toast.error('No se pudo borrar'); return; }
    toast.success('Movimiento borrado');
    invalidateMoney();
  }
  async function bulkUpdate(patch: { category_id?: string; is_fixed?: boolean }, label: string) {
    const ids = [...selected];
    if (ids.length === 0) return;
    const { error } = await supabase.from('transactions').update(patch).in('id', ids);
    if (error) { toast.error('No se pudo actualizar'); return; }
    toast.success(`${ids.length} ${label}`);
    setSelected(new Set());
    setSelectMode(false);
    setBulkCatOpen(false);
    invalidateMoney();
  }
  async function bulkDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!window.confirm(`¿Borrar ${ids.length} movimiento(s)? No se puede deshacer.`)) return;
    const { error } = await supabase.from('transactions').delete().in('id', ids);
    if (error) { toast.error('No se pudo borrar'); return; }
    toast.success(`${ids.length} movimiento(s) borrados`);
    setSelected(new Set());
    setSelectMode(false);
    invalidateMoney();
  }
  // Category (envelope) colour per transaction, to dot the icon and tint the name.
  const catColorById = new Map(categories.map((c) => [c.id, (c.color as string | null) ?? null]));

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F1F5F3' }}>
      {/* Header */}
      <header className="px-5 pt-14 pb-4 flex items-center justify-between sticky top-0 z-20 md:static" style={{ background: '#F1F5F3' }}>
        <div>
          <h1 className="text-2xl font-black" style={{ color: '#18211D' }}>Movimientos</h1>
          <p className="text-xs mt-0.5" style={{ color: '#5B6660' }}>
            {searchActive ? 'Buscando en todo el histórico' : filterRange === 'week' ? `Semana · Lun ${shortDM(week.start)} – Dom ${shortDM(week.end)}` : filterRange === 'month' ? 'Este mes' : 'Histórico'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            className="text-xs font-bold px-3 py-1.5 rounded-full border"
            style={{ borderColor: '#E5EBE8', color: '#5B6660' }}
          >
            Exportar CSV
          </button>
          <button
            onClick={toggle}
            className="text-xs font-bold px-3 py-1.5 rounded-full border"
            style={{ borderColor: '#2FA37C', color: '#2FA37C' }}
          >
            {showUSD ? 'USD' : 'ARS'}
          </button>
        </div>
      </header>

      {/* Month summary — always current-month numbers, so say so explicitly
          (the Semana/Histórico filters don't change this card). */}
      <div className="mx-4 mb-4 rounded-3xl p-5" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
        <div className="flex items-stretch">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0" style={{ background: '#FFE5E0' }}>💸</span>
              <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: '#8C968F' }}>Gastos · mes</p>
            </div>
            <p className="text-xl font-black tabular-nums mt-2 truncate" style={{ color: '#FF6F61' }}>{format(monthSummary.expenses)}</p>
            <p className="text-[11px]" style={{ color: '#8C968F' }}>{secondary(monthSummary.expenses)}</p>
          </div>
          <div className="w-px mx-3 self-stretch" style={{ background: '#EAF0ED' }} />
          <div className="flex-1 min-w-0 text-right">
            <div className="flex items-center justify-end gap-2">
              <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: '#8C968F' }}>Ingresos · mes</p>
              <span className="w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0" style={{ background: '#DDF0E8' }}>💰</span>
            </div>
            <p className="text-xl font-black tabular-nums mt-2 truncate" style={{ color: '#2FA37C' }}>{format(monthSummary.income)}</p>
            <p className="text-[11px]" style={{ color: '#8C968F' }}>{secondary(monthSummary.income)}</p>
          </div>
        </div>
      </div>

      {/* Comparar meses toggle */}
      <div className="px-4 mb-3">
        <button
          onClick={() => setShowChart((v) => !v)}
          className="text-xs font-bold px-4 py-2 rounded-full border transition-all"
          style={{
            background: showChart ? '#18211D' : '#FFFFFF',
            borderColor: showChart ? '#18211D' : '#E5EBE8',
            color: showChart ? '#FFFFFF' : '#5B6660',
            boxShadow: 'var(--shadow-soft)',
          }}
        >
          📊 Comparar meses
        </button>
      </div>

      {/* Chart section */}
      {showChart && (
        <div className="mx-4 mb-4 rounded-3xl p-4" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
          <p className="text-sm font-black mb-3" style={{ color: '#18211D' }}>Top 5 categorías</p>
          {chartData.length === 0 ? (
            <p className="text-sm text-center py-4" style={{ color: '#5B6660' }}>Sin datos de gastos este mes.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#5B6660' }} />
                <YAxis tickFormatter={(v) => formatARS(v)} tick={{ fontSize: 9, fill: '#5B6660' }} width={70} />
                <Tooltip content={<ChartTooltip formatter={formatARS} />} cursor={{ fill: 'rgba(47,163,124,0.06)' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Este mes" fill="#2FA37C" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Mes anterior" fill="#5B6660" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {/* Search + filters */}
      <div className="px-4 mb-3 flex flex-col gap-2">
        <input
          type="search"
          placeholder="🔍 Buscar comercio o descripción…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-4 py-2.5 rounded-2xl text-sm border bg-white outline-none"
          style={{ borderColor: '#E5EBE8', color: '#18211D' }}
        />
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {(['all', 'personal', 'household'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilterScope(s)}
              className="flex-shrink-0 px-3 py-2 rounded-full text-xs font-bold border transition-all"
              style={{
                background: filterScope === s ? '#18211D' : '#FFFFFF',
                borderColor: filterScope === s ? '#18211D' : '#E5EBE8',
                color: filterScope === s ? '#FFFFFF' : '#5B6660',
                boxShadow: 'var(--shadow-soft)',
              }}
            >
              {s === 'all' ? 'Todos' : s === 'personal' ? 'Personal' : 'Hogar'}
            </button>
          ))}
          <button
            onClick={() => setFilterShared(filterShared === true ? null : true)}
            className="flex-shrink-0 px-3 py-2 rounded-full text-xs font-bold border transition-all"
            style={{
              background: filterShared === true ? '#FFE5E0' : '#FFFFFF',
              borderColor: filterShared === true ? '#FF6F61' : '#E5EBE8',
              color: filterShared === true ? '#FF6F61' : '#5B6660',
              boxShadow: 'var(--shadow-soft)',
            }}
          >
            🤝 Compartidos
          </button>
          {/* Date range */}
          {(['all', 'week', 'month'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setFilterRange(r)}
              className="flex-shrink-0 px-3 py-2 rounded-full text-xs font-bold border transition-all"
              style={{
                background: filterRange === r ? '#1F8A68' : '#FFFFFF',
                borderColor: filterRange === r ? '#1F8A68' : '#E5EBE8',
                color: filterRange === r ? '#FFFFFF' : '#5B6660',
                boxShadow: 'var(--shadow-soft)',
              }}
            >
              {r === 'all' ? 'Histórico' : r === 'week' ? '📆 Semana' : 'Mes'}
            </button>
          ))}
        </div>

        {/* Category filter */}
        <div className="flex items-center gap-2">
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="flex-1 px-3 py-2 rounded-2xl text-xs font-bold border bg-white outline-none"
            style={{ borderColor: filterCategory !== 'all' ? '#2FA37C' : '#E5EBE8', color: filterCategory !== 'all' ? '#1F8A68' : '#5B6660' }}
          >
            <option value="all">Todas las categorías</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
            ))}
          </select>
          {filterCategory !== 'all' && (
            <span className="text-xs font-black whitespace-nowrap" style={{ color: '#FF6F61' }}>
              {format(filtered.filter((t) => t.type === 'expense' && !t.exclude_from_stats).reduce((s, t) => s + toArs(t.amount, t.currency), 0))}
            </span>
          )}
        </div>

        {/* Advanced filters + bulk-select toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className="px-3 py-2 rounded-full text-xs font-bold border transition-all"
            style={{
              background: filterAccount !== 'all' || filterMinAmount > 0 || filterFixed === true || !!filterFlag ? '#18211D' : '#FFFFFF',
              borderColor: '#E5EBE8',
              color: filterAccount !== 'all' || filterMinAmount > 0 || filterFixed === true || !!filterFlag ? '#FFFFFF' : '#5B6660',
              boxShadow: 'var(--shadow-soft)',
            }}
          >
            ⚙️ Filtros{filterAccount !== 'all' || filterMinAmount > 0 || filterFixed === true || !!filterFlag ? ' •' : ''}
          </button>
          <button
            onClick={() => { setSelectMode((v) => !v); setSelected(new Set()); }}
            className="px-3 py-2 rounded-full text-xs font-bold border ml-auto transition-all"
            style={{
              background: selectMode ? '#1F8A68' : '#FFFFFF',
              borderColor: selectMode ? '#1F8A68' : '#E5EBE8',
              color: selectMode ? '#FFFFFF' : '#5B6660',
              boxShadow: 'var(--shadow-soft)',
            }}
          >
            {selectMode ? 'Cancelar' : '☑️ Seleccionar'}
          </button>
        </div>
        {showAdvanced && (
          <div className="flex flex-col gap-2 p-3 rounded-2xl" style={{ background: '#F1F5F3' }}>
            <select
              value={filterAccount}
              onChange={(e) => setFilterAccount(e.target.value)}
              className="px-3 py-2 rounded-xl text-xs font-bold border bg-white outline-none"
              style={{ borderColor: filterAccount !== 'all' ? '#2FA37C' : '#E5EBE8', color: '#18211D' }}
            >
              <option value="all">Todas las cuentas</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                placeholder="Monto mínimo ($)"
                value={filterMinAmount || ''}
                onChange={(e) => setFilterMinAmount(Number(e.target.value) || 0)}
                className="flex-1 px-3 py-2 rounded-xl text-xs border bg-white outline-none"
                style={{ borderColor: filterMinAmount > 0 ? '#2FA37C' : '#E5EBE8', color: '#18211D' }}
              />
              <button
                onClick={() => setFilterFixed(filterFixed === true ? null : true)}
                className="px-3 py-2 rounded-xl text-xs font-bold border whitespace-nowrap"
                style={{
                  background: filterFixed === true ? '#FBF1D8' : '#FFFFFF',
                  borderColor: filterFixed === true ? '#F5A623' : '#E5EBE8',
                  color: filterFixed === true ? '#C79A2B' : '#5B6660',
                }}
              >
                📌 Solo fijos
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold" style={{ color: '#5B6660' }}>Flag</span>
              <button onClick={() => setFilterFlag(null)} className="w-6 h-6 rounded-full border flex items-center justify-center text-[10px]" style={{ borderColor: filterFlag === null ? '#18211D' : '#E5EBE8', color: '#5B6660' }}>○</button>
              {FLAG_COLORS.map((f) => (
                <button key={f.key} onClick={() => setFilterFlag(filterFlag === f.key ? null : f.key)} title={f.label} className="w-6 h-6 rounded-full" style={{ background: f.hex, outline: filterFlag === f.key ? '2px solid #18211D' : 'none', outlineOffset: '1px' }} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Reconcile banner (single account) */}
      {selectedAccount && clearedBalance != null && (
        <div className="mx-4 mb-3 rounded-2xl p-4 flex items-center justify-between gap-3" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: '#5B6660' }}>Saldo conciliado · {selectedAccount.name}</p>
            <p className="text-lg font-black tabular-nums" style={{ color: '#18211D' }}>{formatARS(clearedBalance)}</p>
            {selectedAccount.last_reconciled_at && (
              <p className="text-[10px]" style={{ color: '#8C968F' }}>Última conciliación: {new Date(selectedAccount.last_reconciled_at).toLocaleDateString('es-AR')}</p>
            )}
          </div>
          <button onClick={() => { setBankBal(String(clearedBalance)); setReconcileOpen(true); }} className="shrink-0 px-3 py-2 rounded-xl text-xs font-bold" style={{ background: '#DDF0E8', color: '#1F8A68' }}>
            Conciliar
          </button>
        </div>
      )}

      {/* Próximos vencimientos (reglas recurrentes) — solo en la vista normal */}
      {!searchActive && !selectMode && <UpcomingStrip householdId={profile.household_id} profileId={profile.id} />}

      {/* Transactions grouped by day */}
      <div className="px-4 flex flex-col gap-4">
        {grouped.length === 0 && (
          <EmptyState
            icon="💸"
            title="Sin movimientos"
            subtitle="Registrá tu primer gasto o ingreso."
          />
        )}
        {grouped.map(([date, txs]) => (
          <div key={date}>
            <p className="text-xs font-bold mb-2 capitalize" style={{ color: '#5B6660' }}>
              {fmtDate(date)}
            </p>
            <div className="rounded-3xl overflow-hidden" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
              {txs.map((tx, i) => (
                <SwipeAction
                  key={tx.id}
                  onDelete={() => void deleteTx(tx)}
                  disabled={selectMode || isLocked(tx)}
                >
                <button
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left animate-in fade-in slide-in-from-bottom-2 duration-200 transition-colors hover:bg-[#F4F8F6] active:bg-[#EEF3F1]"
                  style={{
                    borderTop: i > 0 ? '1px solid #E5EBE8' : 'none',
                    borderLeft: flagHex(tx.flag) ? `4px solid ${flagHex(tx.flag)}` : undefined,
                    animationDelay: `${i * 30}ms`,
                    background: selectMode && selected.has(tx.id) ? '#DDF0E8' : undefined,
                  }}
                  onClick={() => {
                    if (selectMode) {
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(tx.id)) next.delete(tx.id);
                        else next.add(tx.id);
                        return next;
                      });
                    } else {
                      setEditTx(tx);
                      setSheetOpen(true);
                    }
                  }}
                >
                  {selectMode && (
                    <span
                      className="shrink-0 w-5 h-5 rounded-md border flex items-center justify-center text-white text-xs"
                      style={{ borderColor: selected.has(tx.id) ? '#1F8A68' : '#CFD8D3', background: selected.has(tx.id) ? '#1F8A68' : '#FFFFFF' }}
                    >
                      {selected.has(tx.id) ? '✓' : ''}
                    </span>
                  )}
                  {filterAccount !== 'all' && !selectMode && (
                    <span
                      onClick={(e) => { e.stopPropagation(); if (!isLocked(tx)) void toggleCleared(tx); }}
                      title={isLocked(tx) ? 'Conciliado (bloqueado)' : tx.cleared ? 'Conciliado' : 'Marcar como conciliado'}
                      className="shrink-0 w-5 h-5 rounded-full border flex items-center justify-center text-white text-[11px]"
                      style={{ borderColor: tx.cleared ? '#1F8A68' : '#CFD8D3', background: tx.cleared ? '#1F8A68' : '#FFFFFF', cursor: isLocked(tx) ? 'default' : 'pointer' }}
                    >
                      {isLocked(tx) ? '🔒' : tx.cleared ? '✓' : ''}
                    </span>
                  )}
                  <span className="relative text-2xl shrink-0">
                    {tx.type !== 'transfer' && tx.category_id && catColorById.get(tx.category_id) && (
                      <span className="absolute -left-0.5 top-1 w-1.5 h-1.5 rounded-full" style={{ background: catColorById.get(tx.category_id)! }} />
                    )}
                    {tx.type === 'transfer' ? '🔄' : (tx.categories?.icon ?? '🏷️')}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: '#18211D' }}>
                      {tx.type === 'transfer'
                        ? `${acctName(tx.account_id)} → ${acctName(tx.transfer_account_id)}`
                        : tx.merchant || tx.categories?.name || 'Sin categoría'}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 mt-0.5">
                      {tx.categories?.name && tx.merchant && (
                        <span className="text-xs font-semibold whitespace-nowrap shrink-0" style={{ color: catColorById.get(tx.category_id ?? '') ?? '#5B6660' }}>{tx.categories.name}</span>
                      )}
                      {tx.is_shared && (
                        <span className="text-xs px-1.5 py-0.5 rounded-md font-semibold whitespace-nowrap shrink-0" style={{ background: '#FFE5E0', color: '#FF6F61' }}>
                          Compartido
                        </span>
                      )}
                      {tx.scope === 'household' && (
                        <span className="text-xs px-1.5 py-0.5 rounded-md font-semibold whitespace-nowrap shrink-0" style={{ background: '#DDF0E8', color: '#1F8A68' }}>
                          Hogar
                        </span>
                      )}
                      {tx.installment_total && tx.installment_total > 1 && (
                        <span className="text-xs px-1.5 py-0.5 rounded-md font-semibold whitespace-nowrap shrink-0" style={{ background: '#E5EBE8', color: '#5B6660' }}>
                          Cuota {tx.installment_number}/{tx.installment_total}
                        </span>
                      )}
                      {!selectMode && itemTxIds.has(tx.id) && (
                        <span
                          onClick={(e) => { e.stopPropagation(); setItemsTx(tx); }}
                          className="text-xs px-1.5 py-0.5 rounded-md font-semibold cursor-pointer whitespace-nowrap shrink-0"
                          style={{ background: '#FBF1D8', color: '#C79A2B' }}
                        >
                          🧾 Productos
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p
                      className="text-base font-black"
                      style={{ color: tx.type === 'expense' ? '#FF6F61' : tx.type === 'transfer' ? '#4E84E0' : '#2FA37C' }}
                    >
                      {tx.type === 'expense' ? '-' : tx.type === 'transfer' ? '' : '+'}{format(toArs(tx.amount, tx.currency))}
                    </p>
                    <p className="text-xs" style={{ color: '#5B6660' }}>{secondary(toArs(tx.amount, tx.currency))}</p>
                    {runningBalance && (
                      <p className="text-[10px] tabular-nums" style={{ color: '#8C968F' }}>saldo {formatARS(runningBalance.get(tx.id) ?? 0)}</p>
                    )}
                  </div>
                </button>
                </SwipeAction>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* By-category summary */}
      <CategorySummary
        transactions={scopeFiltered
          .filter((tx) => {
            const now = new Date();
            const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            return tx.occurred_on.startsWith(month) && tx.type === 'expense' && !tx.exclude_from_stats;
          })
          .map((tx) => ({ ...tx, amount: toArs(tx.amount, tx.currency) }))}
        categories={categories}
        format={format}
      />

      {/* Bulk action bar */}
      {selectMode && selected.size > 0 && (
        <div className="fixed left-0 right-0 z-40 px-4" style={{ bottom: 'calc(76px + env(safe-area-inset-bottom))' }}>
          <div className="rounded-2xl shadow-lg flex items-center gap-2 p-2" style={{ background: '#18211D' }}>
            <span className="text-xs font-bold px-1.5 shrink-0" style={{ color: '#FFFFFF' }}>{selected.size} sel.</span>
            <button onClick={() => setBulkCatOpen(true)} className="flex-1 px-3 py-2 rounded-xl text-xs font-bold" style={{ background: '#1F8A68', color: '#FFFFFF' }}>Categorizar</button>
            <button onClick={() => bulkUpdate({ is_fixed: true }, 'marcados como fijos')} className="px-3 py-2 rounded-xl text-xs font-bold" style={{ background: '#F5A623', color: '#FFFFFF' }}>📌 Fijo</button>
            <button onClick={bulkDelete} className="px-3 py-2 rounded-xl text-xs font-bold" style={{ background: '#FF6F61', color: '#FFFFFF' }}>🗑️</button>
          </div>
        </div>
      )}

      {/* Bulk categorize picker */}
      {bulkCatOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center" style={{ background: 'rgba(20,28,24,0.45)' }} onClick={() => setBulkCatOpen(false)}>
          <div className="w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl p-6 max-h-[70vh] overflow-y-auto" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)', paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }} onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: '#E5EBE8' }} />
            <h2 className="text-lg font-black mb-1" style={{ color: '#18211D' }}>Asignar categoría</h2>
            <p className="text-xs mb-4" style={{ color: '#5B6660' }}>A {selected.size} movimiento(s) seleccionados.</p>
            <div className="flex flex-col gap-1">
              {categories.filter((c) => c.kind === 'expense').map((c) => (
                <button key={c.id} onClick={() => bulkUpdate({ category_id: c.id }, `movidos a ${c.name}`)} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-left" style={{ background: '#F1F5F3' }}>
                  <span className="text-xl">{c.icon}</span>
                  <span className="text-sm font-semibold" style={{ color: '#18211D' }}>{c.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Reconcile sheet */}
      {reconcileOpen && selectedAccount && clearedBalance != null && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center" style={{ background: 'rgba(20,28,24,0.45)' }} onClick={() => setReconcileOpen(false)}>
          <div className="w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl p-6" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)', paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }} onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: '#E5EBE8' }} />
            <h2 className="text-lg font-black mb-1" style={{ color: '#18211D' }}>Conciliar {selectedAccount.name}</h2>
            <p className="text-xs mb-4" style={{ color: '#5B6660' }}>
              Saldo de los movimientos marcados ✓: <b>{formatARS(clearedBalance)}</b>. Ingresá el saldo real que muestra el banco hoy; si hay diferencia, creamos un ajuste.
            </p>
            <label className="text-[11px] font-bold uppercase tracking-wide" style={{ color: '#5B6660' }}>Saldo real del banco</label>
            <input
              type="number"
              inputMode="numeric"
              value={bankBal}
              onChange={(e) => setBankBal(e.target.value)}
              className="w-full mt-1 mb-3 px-4 py-3 rounded-2xl text-base font-bold border-2 outline-none"
              style={{ background: '#F1F5F3', color: '#18211D', borderColor: '#E5EBE8' }}
            />
            {bankBal.trim() !== '' && Number.isFinite(Number(bankBal)) && (() => {
              const diff = Math.round(Number(bankBal) - clearedBalance);
              return (
                <p className="text-xs mb-3" style={{ color: diff === 0 ? '#1F8A68' : '#C79A2B' }}>
                  {diff === 0 ? '✓ Coincide, no hace falta ajuste.' : `Se creará un ajuste de ${formatARS(Math.abs(diff))} (${diff > 0 ? 'ingreso' : 'gasto'}).`}
                </p>
              );
            })()}
            <button onClick={doReconcile} className="w-full py-3 rounded-2xl text-sm font-bold text-white" style={{ background: '#1F8A68' }}>
              Conciliar
            </button>
          </div>
        </div>
      )}

      <BottomNav onFab={(type) => { setEditTx(null); setFabType(type); setSheetOpen(true); }} />

      <AddTransactionSheet
        open={sheetOpen}
        initialType={fabType}
        onClose={() => { setSheetOpen(false); setEditTx(null); }}
        householdId={profile.household_id}
        profileId={profile.id}
        partnerProfileId={partnerProfileId}
        categories={categories}
        accounts={accounts}
        editTx={editTx}
      />

      <ReceiptItemsSheet
        open={!!itemsTx}
        onClose={() => setItemsTx(null)}
        householdId={profile.household_id}
        transactionId={itemsTx?.id ?? null}
        merchant={itemsTx?.merchant ?? null}
        total={itemsTx?.amount ?? 0}
        currency={itemsTx?.currency ?? 'ARS'}
        occurredOn={itemsTx?.occurred_on ?? todayISO()}
      />
    </div>
  );
}

function CategorySummary({
  transactions,
  categories,
  format,
}: {
  transactions: Tx[];
  categories: { id: string; name: string; icon: string; kind: string }[];
  format: (n: number) => string;
}) {
  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const tx of transactions) {
      const id = tx.category_id ?? '__none__';
      map.set(id, (map.get(id) ?? 0) + tx.amount);
    }
    const total = [...map.values()].reduce((a, b) => a + b, 0);
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, amount]) => ({
        id,
        amount,
        pct: total > 0 ? Math.round((amount / total) * 100) : 0,
        cat: categories.find((c) => c.id === id),
      }));
  }, [transactions, categories]);

  if (byCategory.length === 0) return null;

  return (
    <div className="mx-4 mt-6 mb-2">
      <p className="text-sm font-black mb-3" style={{ color: '#18211D' }}>Por categoría (este mes)</p>
      <div className="rounded-3xl overflow-hidden" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
        {byCategory.map((row, i) => (
          <div
            key={row.id}
            className="flex items-center gap-3 px-4 py-3"
            style={{ borderTop: i > 0 ? '1px solid #E5EBE8' : 'none' }}
          >
            <span className="text-xl">{row.cat?.icon ?? '🏷️'}</span>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-baseline mb-1">
                <p className="text-sm font-semibold" style={{ color: '#18211D' }}>
                  {row.cat?.name ?? 'Sin categoría'}
                </p>
                <p className="text-sm font-black" style={{ color: '#FF6F61' }}>{format(row.amount)}</p>
              </div>
              <div className="h-1.5 rounded-full" style={{ background: '#E5EBE8' }}>
                <div
                  className="h-1.5 rounded-full"
                  style={{ width: `${row.pct}%`, background: '#FF6F61' }}
                />
              </div>
            </div>
            <span className="text-xs font-bold w-8 text-right" style={{ color: '#5B6660' }}>{row.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
