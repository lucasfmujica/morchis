'use client';

import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { useFx } from '@/hooks/useFx';
import { AddTransactionSheet } from '@/components/AddTransactionSheet';
import { BottomNav } from '@/components/BottomNav';
import { EmptyState } from '@/components/EmptyState';
import { exportTransactionsToCSV } from '@/lib/csvExport';
import { formatARS } from '@/lib/format';
import { todayISO } from '@/lib/date';
import { toast } from 'sonner';
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
  category_id: string | null;
  account_id: string | null;
  scope: string;
  is_shared: boolean;
  merchant: string | null;
  occurred_on: string;
  profile_id: string;
  installment_number: number | null;
  installment_total: number | null;
  categories: { name: string; icon: string } | null;
};

export default function MovimientosClient({ profile, partnerProfileId }: MovimientosClientProps) {
  const supabase = createClient();
  const { format, secondary, toggle, showUSD } = useFx();
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fabType, setFabType] = useState<'expense' | 'income'>('expense');
  const [editTx, setEditTx] = useState<Tx | null>(null);
  const [search, setSearch] = useState('');
  const [filterScope, setFilterScope] = useState<'all' | 'personal' | 'household'>('personal');
  const [filterShared, setFilterShared] = useState<boolean | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [showChart, setShowChart] = useState(false);

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('categories')
        .select('id, name, icon, kind, color')
        .eq('household_id', profile.household_id)
        .order('name');
      return data ?? [];
    },
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('accounts')
        .select('id, name, type')
        .eq('household_id', profile.household_id)
        .eq('archived', false)
        .order('name');
      return data ?? [];
    },
  });

  const { data: transactions = [] } = useQuery<Tx[]>({
    queryKey: ['transactions', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('id, amount, type, category_id, account_id, scope, is_shared, merchant, occurred_on, profile_id, installment_number, installment_total, categories:category_id(name, icon)')
        .eq('household_id', profile.household_id)
        .order('occurred_on', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(200);
      return (data as Tx[]) ?? [];
    },
  });

  // Visibility rule: each user only sees their own personal movements plus the
  // shared household ones. The partner's personal movements never show here.
  const visibleTransactions = useMemo(
    () => transactions.filter((tx) => tx.scope === 'household' || tx.profile_id === profile.id),
    [transactions, profile.id],
  );

  const filtered = useMemo(() => {
    return visibleTransactions.filter((tx) => {
      if (filterScope !== 'all' && tx.scope !== filterScope) return false;
      if (filterShared !== null && tx.is_shared !== filterShared) return false;
      if (filterCategory !== 'all' && tx.category_id !== filterCategory) return false;
      if (search) {
        const q = search.toLowerCase();
        const m = tx.merchant?.toLowerCase() ?? '';
        const c = tx.categories?.name?.toLowerCase() ?? '';
        if (!m.includes(q) && !c.includes(q)) return false;
      }
      return true;
    });
  }, [visibleTransactions, filterScope, filterShared, filterCategory, search]);

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

  const monthSummary = useMemo(() => {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const current = visibleTransactions.filter((tx) => tx.occurred_on.startsWith(month));
    const expenses = current.filter((tx) => tx.type === 'expense').reduce((s, tx) => s + tx.amount, 0);
    const income = current.filter((tx) => tx.type === 'income').reduce((s, tx) => s + tx.amount, 0);
    return { expenses, income };
  }, [visibleTransactions]);

  // Chart data: top 5 categories current vs previous month
  const chartData = useMemo(() => {
    const now = new Date();
    const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

    const curMap = new Map<string, number>();
    const prevMap = new Map<string, number>();

    for (const tx of visibleTransactions) {
      if (tx.type !== 'expense') continue;
      const id = tx.category_id ?? '__none__';
      if (tx.occurred_on.startsWith(curMonth)) {
        curMap.set(id, (curMap.get(id) ?? 0) + tx.amount);
      } else if (tx.occurred_on.startsWith(prevMonth)) {
        prevMap.set(id, (prevMap.get(id) ?? 0) + tx.amount);
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
  }, [visibleTransactions, categories]);

  async function handleDelete(id: string) {
    const { error } = await supabase.from('transactions').delete().eq('id', id);
    if (error) { toast.error('No se pudo eliminar.'); return; }
    await qc.invalidateQueries({ queryKey: ['transactions'] });
    toast.success('Eliminado');
  }

  function handleExport() {
    const filename = `movimientos-${todayISO()}.csv`;
    exportTransactionsToCSV(filtered, filename);
  }

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F9F5F0' }}>
      {/* Header */}
      <header className="px-5 pt-14 pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black" style={{ color: '#2D2D2D' }}>Movimientos</h1>
          <p className="text-xs mt-0.5" style={{ color: '#6B6459' }}>Este mes</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            className="text-xs font-bold px-3 py-1.5 rounded-full border"
            style={{ borderColor: '#ECE5DC', color: '#6B6459' }}
          >
            Exportar CSV
          </button>
          <button
            onClick={toggle}
            className="text-xs font-bold px-3 py-1.5 rounded-full border"
            style={{ borderColor: '#7EC8A4', color: '#7EC8A4' }}
          >
            {showUSD ? 'USD' : 'ARS'}
          </button>
        </div>
      </header>

      {/* Month summary */}
      <div className="mx-4 mb-4 rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
        <div className="flex justify-between">
          <div>
            <p className="text-xs font-semibold" style={{ color: '#6B6459' }}>Gastos</p>
            <p className="text-xl font-black" style={{ color: '#FF7F6B' }}>{format(monthSummary.expenses)}</p>
            <p className="text-xs" style={{ color: '#6B6459' }}>{secondary(monthSummary.expenses)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold" style={{ color: '#6B6459' }}>Ingresos</p>
            <p className="text-xl font-black" style={{ color: '#7EC8A4' }}>{format(monthSummary.income)}</p>
            <p className="text-xs" style={{ color: '#6B6459' }}>{secondary(monthSummary.income)}</p>
          </div>
        </div>
      </div>

      {/* Comparar meses toggle */}
      <div className="px-4 mb-3">
        <button
          onClick={() => setShowChart((v) => !v)}
          className="text-xs font-bold px-4 py-2 rounded-full border"
          style={{
            background: showChart ? '#2D2D2D' : '#FFFFFF',
            borderColor: showChart ? '#2D2D2D' : '#ECE5DC',
            color: showChart ? '#FFFFFF' : '#6B6459',
          }}
        >
          📊 Comparar meses
        </button>
      </div>

      {/* Chart section */}
      {showChart && (
        <div className="mx-4 mb-4 rounded-3xl p-4" style={{ background: '#FFFFFF' }}>
          <p className="text-sm font-black mb-3" style={{ color: '#2D2D2D' }}>Top 5 categorías</p>
          {chartData.length === 0 ? (
            <p className="text-sm text-center py-4" style={{ color: '#6B6459' }}>Sin datos de gastos este mes.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#6B6459' }} />
                <YAxis tickFormatter={(v) => formatARS(v)} tick={{ fontSize: 9, fill: '#6B6459' }} width={70} />
                <Tooltip formatter={(v) => formatARS(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Este mes" fill="#7EC8A4" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Mes anterior" fill="#6B6459" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {/* Search + filters */}
      <div className="px-4 mb-3 flex flex-col gap-2">
        <input
          type="search"
          placeholder="Buscar..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-4 py-2.5 rounded-2xl text-sm border bg-white outline-none"
          style={{ borderColor: '#ECE5DC', color: '#2D2D2D' }}
        />
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {(['all', 'personal', 'household'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilterScope(s)}
              className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border"
              style={{
                background: filterScope === s ? '#2D2D2D' : '#FFFFFF',
                borderColor: filterScope === s ? '#2D2D2D' : '#ECE5DC',
                color: filterScope === s ? '#FFFFFF' : '#6B6459',
              }}
            >
              {s === 'all' ? 'Todos' : s === 'personal' ? 'Personal' : 'Hogar'}
            </button>
          ))}
          <button
            onClick={() => setFilterShared(filterShared === true ? null : true)}
            className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border"
            style={{
              background: filterShared === true ? '#FFE7E2' : '#FFFFFF',
              borderColor: filterShared === true ? '#FF7F6B' : '#ECE5DC',
              color: filterShared === true ? '#FF7F6B' : '#6B6459',
            }}
          >
            🤝 Compartidos
          </button>
        </div>

        {/* Category filter */}
        <div className="flex items-center gap-2">
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="flex-1 px-3 py-2 rounded-2xl text-xs font-bold border bg-white outline-none"
            style={{ borderColor: filterCategory !== 'all' ? '#7EC8A4' : '#ECE5DC', color: filterCategory !== 'all' ? '#5BA886' : '#6B6459' }}
          >
            <option value="all">Todas las categorías</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
            ))}
          </select>
          {filterCategory !== 'all' && (
            <span className="text-xs font-black whitespace-nowrap" style={{ color: '#FF7F6B' }}>
              {format(filtered.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0))}
            </span>
          )}
        </div>
      </div>

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
            <p className="text-xs font-bold mb-2 capitalize" style={{ color: '#6B6459' }}>
              {fmtDate(date)}
            </p>
            <div className="rounded-3xl overflow-hidden" style={{ background: '#FFFFFF' }}>
              {txs.map((tx, i) => (
                <button
                  key={tx.id}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left animate-in fade-in slide-in-from-bottom-2 duration-200"
                  style={{
                    borderTop: i > 0 ? '1px solid #ECE5DC' : 'none',
                    animationDelay: `${i * 30}ms`,
                  }}
                  onClick={() => {
                    setEditTx(tx);
                    setSheetOpen(true);
                  }}
                >
                  <span className="text-2xl">{tx.categories?.icon ?? '🏷️'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: '#2D2D2D' }}>
                      {tx.merchant || tx.categories?.name || 'Sin categoría'}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {tx.categories?.name && tx.merchant && (
                        <span className="text-xs" style={{ color: '#6B6459' }}>{tx.categories.name}</span>
                      )}
                      {tx.is_shared && (
                        <span className="text-xs px-1.5 py-0.5 rounded-md font-semibold" style={{ background: '#FFE7E2', color: '#FF7F6B' }}>
                          Compartido
                        </span>
                      )}
                      {tx.scope === 'household' && (
                        <span className="text-xs px-1.5 py-0.5 rounded-md font-semibold" style={{ background: '#E4F2EA', color: '#5BA886' }}>
                          Hogar
                        </span>
                      )}
                      {tx.installment_total && tx.installment_total > 1 && (
                        <span className="text-xs px-1.5 py-0.5 rounded-md font-semibold" style={{ background: '#ECE5DC', color: '#6B6459' }}>
                          Cuota {tx.installment_number}/{tx.installment_total}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p
                      className="text-base font-black"
                      style={{ color: tx.type === 'expense' ? '#FF7F6B' : '#7EC8A4' }}
                    >
                      {tx.type === 'expense' ? '-' : '+'}{format(tx.amount)}
                    </p>
                    <p className="text-xs" style={{ color: '#6B6459' }}>{secondary(tx.amount)}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* By-category summary */}
      <CategorySummary
        transactions={visibleTransactions.filter((tx) => {
          const now = new Date();
          const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
          return tx.occurred_on.startsWith(month) && tx.type === 'expense';
        })}
        categories={categories}
        format={format}
      />

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
      <p className="text-sm font-black mb-3" style={{ color: '#2D2D2D' }}>Por categoría (este mes)</p>
      <div className="rounded-3xl overflow-hidden" style={{ background: '#FFFFFF' }}>
        {byCategory.map((row, i) => (
          <div
            key={row.id}
            className="flex items-center gap-3 px-4 py-3"
            style={{ borderTop: i > 0 ? '1px solid #ECE5DC' : 'none' }}
          >
            <span className="text-xl">{row.cat?.icon ?? '🏷️'}</span>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-baseline mb-1">
                <p className="text-sm font-semibold" style={{ color: '#2D2D2D' }}>
                  {row.cat?.name ?? 'Sin categoría'}
                </p>
                <p className="text-sm font-black" style={{ color: '#FF7F6B' }}>{format(row.amount)}</p>
              </div>
              <div className="h-1.5 rounded-full" style={{ background: '#ECE5DC' }}>
                <div
                  className="h-1.5 rounded-full"
                  style={{ width: `${row.pct}%`, background: '#FF7F6B' }}
                />
              </div>
            </div>
            <span className="text-xs font-bold w-8 text-right" style={{ color: '#6B6459' }}>{row.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
