'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { useFx } from '@/hooks/useFx';
import { BottomNav } from '@/components/BottomNav';
import { AddTransactionSheet } from '@/components/AddTransactionSheet';
import { SingleBars, lastSixMonths } from '@/components/MonthlyBars';
import { EmptyState } from '@/components/EmptyState';
import { formatARS } from '@/lib/format';
import Link from 'next/link';

interface Profile {
  id: string;
  household_id: string;
  nickname: string | null;
  display_name: string | null;
}

interface Category {
  id: string;
  name: string;
  icon: string;
  color: string | null;
  kind: string;
}

type Tx = {
  id: string;
  amount: number;
  type: string;
  category_id: string | null;
  account_id: string | null;
  merchant: string | null;
  occurred_on: string;
  scope: string;
  is_shared: boolean;
};

export default function CategoryDetailClient({ profile, category }: { profile: Profile; category: Category }) {
  const supabase = createClient();
  const { format } = useFx();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editTx, setEditTx] = useState<Tx | null>(null);

  const today = new Date();
  const months = lastSixMonths(today);
  const currentKey = months[months.length - 1].key;
  const rangeStart = `${months[0].key}-01`;
  const accent = category.color || (category.kind === 'income' ? '#7EC8A4' : '#FF7F6B');

  const { data: txns = [] } = useQuery<Tx[]>({
    queryKey: ['category-tx', category.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('id, amount, type, category_id, account_id, merchant, occurred_on, scope, is_shared')
        .eq('household_id', profile.household_id)
        .eq('category_id', category.id)
        .gte('occurred_on', rangeStart)
        .order('occurred_on', { ascending: false });
      return (data ?? []) as Tx[];
    },
  });

  // Active budget for this category
  const { data: budget = 0 } = useQuery<number>({
    queryKey: ['category-budget', category.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('budgets')
        .select('amount')
        .eq('household_id', profile.household_id)
        .eq('category_id', category.id)
        .eq('active', true);
      return (data ?? []).reduce((s, b) => s + b.amount, 0);
    },
  });

  const monthRows = months.map((m) => ({
    key: m.key,
    label: m.label,
    value: txns.filter((t) => t.occurred_on.startsWith(m.key)).reduce((s, t) => s + t.amount, 0),
  }));
  const thisMonth = monthRows[monthRows.length - 1].value;
  const monthsWithData = monthRows.filter((r) => r.value > 0);
  const avg = monthsWithData.length > 0 ? Math.round(monthsWithData.reduce((s, r) => s + r.value, 0) / monthsWithData.length) : 0;
  const pct = budget > 0 ? thisMonth / budget : 0;
  const barCol = pct >= 1 ? '#FF7F6B' : pct >= 0.8 ? '#F5A623' : accent;

  const thisMonthTx = txns.filter((t) => t.occurred_on.startsWith(currentKey));

  function fmtDate(d: string) {
    return new Date(d + 'T00:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
  }

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F9F5F0' }}>
      <header className="px-5 pt-14 pb-4 flex items-center gap-3">
        <Link href="/analisis" className="text-2xl">←</Link>
        <h1 className="text-2xl font-black flex items-center gap-2" style={{ color: '#2D2D2D' }}>
          <span>{category.icon}</span> {category.name}
        </h1>
      </header>

      <div className="px-4 flex flex-col gap-4">
        {/* Summary */}
        <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
          <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: '#8A8276' }}>Este mes</p>
          <p className="text-3xl font-black leading-none mb-1" style={{ color: accent, fontVariantNumeric: 'tabular-nums' }}>
            {formatARS(thisMonth)}
          </p>
          <p className="text-xs" style={{ color: '#8A8276' }}>Promedio 6 meses: {formatARS(avg)}</p>

          {budget > 0 && (
            <div className="mt-4">
              <div className="h-2.5 rounded-full overflow-hidden" style={{ background: '#ECE5DC' }}>
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(pct * 100, 100)}%`, background: barCol }} />
              </div>
              <div className="flex justify-between mt-1.5">
                <span className="text-xs font-bold" style={{ color: barCol }}>{Math.round(pct * 100)}% del presupuesto</span>
                <span className="text-xs" style={{ color: '#8A8276' }}>de {formatARS(budget)}</span>
              </div>
            </div>
          )}
        </div>

        {/* 6-month evolution */}
        <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
          <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: '#8A8276' }}>Evolución · 6 meses</p>
          <SingleBars rows={monthRows} color={accent} />
        </div>

        {/* This month's movements */}
        <div>
          <p className="text-sm font-black mb-2 px-1" style={{ color: '#2D2D2D' }}>Movimientos de este mes</p>
          {thisMonthTx.length === 0 ? (
            <EmptyState icon={category.icon} title="Sin movimientos" subtitle="No hay registros en esta categoría este mes." />
          ) : (
            <div className="rounded-3xl overflow-hidden" style={{ background: '#FFFFFF' }}>
              {thisMonthTx.map((tx, i) => (
                <button
                  key={tx.id}
                  onClick={() => { setEditTx(tx); setSheetOpen(true); }}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
                  style={{ borderTop: i > 0 ? '1px solid #ECE5DC' : 'none' }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: '#2D2D2D' }}>{tx.merchant || category.name}</p>
                    <p className="text-xs" style={{ color: '#8A8276' }}>{fmtDate(tx.occurred_on)}{tx.is_shared ? ' · compartido' : ''}</p>
                  </div>
                  <p className="text-base font-black" style={{ color: tx.type === 'expense' ? '#FF7F6B' : '#7EC8A4' }}>
                    {tx.type === 'expense' ? '-' : '+'}{format(tx.amount)}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <BottomNav onFab={() => { setEditTx(null); setSheetOpen(true); }} />
      <AddTransactionSheet
        open={sheetOpen}
        initialType={category.kind === 'income' ? 'income' : 'expense'}
        onClose={() => { setSheetOpen(false); setEditTx(null); }}
        householdId={profile.household_id}
        profileId={profile.id}
        categories={[]}
        accounts={[]}
        editTx={editTx}
      />
    </div>
  );
}
