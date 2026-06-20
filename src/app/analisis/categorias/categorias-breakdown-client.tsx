'use client';

import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { useFx } from '@/hooks/useFx';
import { BottomNav } from '@/components/BottomNav';
import { AddTransactionSheet } from '@/components/AddTransactionSheet';
import { DonutChart } from '@/components/DonutChart';
import { myShareArs, type SplitRow } from '@/lib/budgets';
import { monthKey, toLocalISO } from '@/lib/date';
import { formatARS } from '@/lib/format';
import Link from 'next/link';

interface Profile {
  id: string;
  household_id: string;
  nickname: string | null;
  display_name: string | null;
}

const DONUT_PALETTE = ['#7EC8A4', '#FF7F6B', '#F5A623', '#6FA8DC', '#B084CC', '#E89AC7', '#5BA886', '#C4B9AE'];

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

export default function CategoriasBreakdownClient({
  profile,
  partnerProfileId,
  partnerName,
}: {
  profile: Profile;
  partnerProfileId?: string;
  partnerName?: string;
}) {
  const supabase = createClient();
  const { arsPerUsd } = useFx();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fabType, setFabType] = useState<'expense' | 'income' | 'transfer'>('expense');
  // Default to "Mío" so the breakdown is personal, consistent with the rest.
  const [scope, setScope] = useState<'me' | 'all' | 'partner'>('me');
  const scopeProfileId = scope === 'me' ? profile.id : scope === 'partner' ? partnerProfileId : undefined;
  const scopeTabs = [
    { key: 'me' as const, label: 'Mío' },
    { key: 'all' as const, label: 'Nuestro' },
    ...(partnerProfileId ? [{ key: 'partner' as const, label: partnerName || 'Pareja' }] : []),
  ];

  const { monthStart, monthEnd } = useMemo(() => {
    const t = new Date();
    return {
      monthStart: monthKey(t) + '-01',
      monthEnd: toLocalISO(new Date(t.getFullYear(), t.getMonth() + 1, 0)),
    };
  }, []);

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

  // Current month's expenses with splits, so each person's share is exact
  // (a shared bill is divided, not credited entirely to whoever paid).
  const { data: txns = [] } = useQuery<Txn[]>({
    queryKey: ['category-breakdown-tx', profile.household_id, monthStart],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('amount, type, occurred_on, category_id, profile_id, currency, is_shared, scope, splits(payer_profile_id, ower_profile_id, amount)')
        .eq('household_id', profile.household_id)
        .eq('type', 'expense')
        .gte('occurred_on', monthStart)
        .lte('occurred_on', monthEnd);
      return (data ?? []) as Txn[];
    },
  });

  const toArs = useCallback(
    (amount: number, currency?: string | null) =>
      currency === 'USD' && arsPerUsd > 0 ? Math.round(amount * arsPerUsd) : amount,
    [arsPerUsd],
  );

  // Per-person expense share, in ARS — mirrors Análisis / Presupuestos.
  const expenseShareArs = useCallback(
    (t: Txn, pid: string | undefined): number => {
      if (!pid) return toArs(t.amount, t.currency); // "Nuestro" → combined household
      if (!t.is_shared) return t.profile_id === pid ? toArs(t.amount, t.currency) : 0;
      return myShareArs(t, pid, arsPerUsd);
    },
    [toArs, arsPerUsd],
  );

  const { rows, total, segments } = useMemo(() => {
    const catById = new Map(categories.map((c) => [c.id, c]));
    const spentByCat = new Map<string, { value: number; count: number }>();
    for (const t of txns) {
      if (!t.category_id) continue;
      const share = expenseShareArs(t, scopeProfileId);
      if (share <= 0) continue;
      const prev = spentByCat.get(t.category_id) ?? { value: 0, count: 0 };
      spentByCat.set(t.category_id, { value: prev.value + share, count: prev.count + 1 });
    }
    const rows = [...spentByCat.entries()]
      .map(([id, v]) => ({ id, cat: catById.get(id), value: v.value, count: v.count }))
      .filter((r) => r.cat && r.value > 0)
      .sort((a, b) => b.value - a.value);
    const total = rows.reduce((s, r) => s + r.value, 0);
    // Donut: top 6 + "Otras".
    const TOP = 6;
    const segments = rows.slice(0, TOP).map((r, i) => ({
      label: r.cat!.name,
      value: r.value,
      color: r.cat!.color || DONUT_PALETTE[i % DONUT_PALETTE.length],
    }));
    const restTotal = rows.slice(TOP).reduce((s, r) => s + r.value, 0);
    if (restTotal > 0) segments.push({ label: 'Otras', value: restTotal, color: '#C4B9AE' });
    return { rows, total, segments };
  }, [txns, categories, scopeProfileId, expenseShareArs]);

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F9F5F0' }}>
      <header className="px-5 pt-14 pb-4 flex items-center gap-3">
        <Link href="/analisis" className="text-2xl">←</Link>
        <h1 className="text-2xl font-black" style={{ color: '#2D2D2D' }}>Gastos por categoría</h1>
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
        {rows.length === 0 ? (
          <div className="rounded-3xl p-8 text-center" style={{ background: '#FFFFFF' }}>
            <p className="text-4xl mb-3">🧮</p>
            <p className="font-bold" style={{ color: '#2D2D2D' }}>Sin gastos este mes</p>
            <p className="text-sm mt-1" style={{ color: '#6B6459' }}>Cuando registres gastos vas a ver acá el detalle por categoría.</p>
          </div>
        ) : (
          <>
            {/* Donut + month total */}
            <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#6B6459' }}>Este mes</p>
                <span className="text-sm font-black" style={{ color: '#FF7F6B' }}>{formatARS(total)}</span>
              </div>
              <div className="flex justify-center">
                <DonutChart segments={segments} centerTop="Total" centerBottom={formatARS(total)} />
              </div>
            </div>

            {/* Full ranked list of every category with spend */}
            <div className="rounded-3xl overflow-hidden" style={{ background: '#FFFFFF' }}>
              {rows.map((r, i) => {
                const pct = total > 0 ? r.value / total : 0;
                const color = r.cat!.color || DONUT_PALETTE[i % DONUT_PALETTE.length];
                return (
                  <div
                    key={r.id}
                    className="block px-4 py-3.5"
                    style={{ borderTop: i > 0 ? '1px solid #ECE5DC' : 'none' }}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{r.cat!.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: '#2D2D2D' }}>{r.cat!.name}</p>
                        <p className="text-[11px]" style={{ color: '#6B6459' }}>{r.count} {r.count === 1 ? 'movimiento' : 'movimientos'}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-black" style={{ color: '#2D2D2D' }}>{formatARS(r.value)}</p>
                        <p className="text-[11px]" style={{ color: '#6B6459' }}>{Math.round(pct * 100)}%</p>
                      </div>
                    </div>
                    <div className="mt-2 ml-11 h-1.5 rounded-full overflow-hidden" style={{ background: '#ECE5DC' }}>
                      <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, background: color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <BottomNav onFab={(type) => { setFabType(type); setSheetOpen(true); }} />
      <AddTransactionSheet
        open={sheetOpen}
        initialType={fabType}
        onClose={() => setSheetOpen(false)}
        householdId={profile.household_id}
        profileId={profile.id}
        partnerProfileId={partnerProfileId}
        categories={categories}
        accounts={[]}
      />
    </div>
  );
}
