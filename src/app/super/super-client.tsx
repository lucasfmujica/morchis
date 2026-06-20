'use client';

import { useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { useFx } from '@/hooks/useFx';
import { BottomNav } from '@/components/BottomNav';
import { EmptyState } from '@/components/EmptyState';
import { ReceiptItemsSheet } from '@/components/ReceiptItemsSheet';
import { ITEM_GROUPS, groupMeta } from '@/lib/itemGroups';

interface Profile {
  id: string;
  household_id: string;
  nickname: string | null;
  display_name: string | null;
}

// One scanned line item joined to its parent purchase (the transaction).
type SuperItem = {
  id: string;
  name: string;
  qty: number | null;
  line_total: number;
  item_group: string;
  transaction: {
    id: string;
    merchant: string | null;
    occurred_on: string;
    currency: string;
    amount: number;
    scope: string;
    profile_id: string;
    category: { id: string; name: string; icon: string | null } | null;
  } | null;
};

type Range = 'month' | 'prev' | 'all';

// Accent-insensitive normalisation for grocery-category detection.
function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
// The food-group breakdown only makes sense for grocery shopping, so by default
// /super shows just supermarket-type categories and leaves cafés, restaurants,
// etc. out — even though they were also scanned into items.
function isGrocery(name: string): boolean {
  return /super|almac|mercado|verduler|carnicer|fiambr|dietetic|granja/.test(norm(name));
}

export default function SuperClient({ profile }: { profile: Profile }) {
  const supabase = createClient();
  const { format, arsPerUsd } = useFx();
  const toArs = useCallback(
    (amount: number, currency: string) =>
      currency === 'USD' && arsPerUsd > 0 ? Math.round(amount * arsPerUsd) : amount,
    [arsPerUsd],
  );

  const [range, setRange] = useState<Range>('month');
  // Category filter: 'grocery' (default — supermarket-type only), 'all', or a
  // specific category id.
  const [catFilter, setCatFilter] = useState<string>('grocery');
  // Tapped purchase → opens the editable per-purchase detail sheet.
  const [openTx, setOpenTx] = useState<SuperItem['transaction'] | null>(null);

  const { data: items = [], isLoading } = useQuery<SuperItem[]>({
    queryKey: ['super-items', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('transaction_items')
        .select(
          'id, name, qty, line_total, item_group, transaction:transaction_id(id, merchant, occurred_on, currency, amount, scope, profile_id, category:category_id(id, name, icon))',
        )
        .eq('household_id', profile.household_id)
        .order('created_at', { ascending: false });
      return (data as unknown as SuperItem[]) ?? [];
    },
  });

  const now = new Date();
  const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

  // Visibility (same rule as /movimientos): my personal items + household ones;
  // then the period filter on the parent purchase's date. Category filtering is
  // applied separately so the chips can reflect what's in the period.
  const scoped = useMemo(
    () =>
      items.filter((it) => {
        const tx = it.transaction;
        if (!tx) return false;
        if (!(tx.scope === 'household' || tx.profile_id === profile.id)) return false;
        if (range === 'month') return tx.occurred_on.startsWith(curMonth);
        if (range === 'prev') return tx.occurred_on.startsWith(prevMonth);
        return true;
      }),
    [items, range, profile.id, curMonth, prevMonth],
  );

  // Categories present in the period (one entry per category, with how many
  // distinct purchases it has) — drives the filter chips.
  const presentCategories = useMemo(() => {
    const map = new Map<string, { id: string; name: string; icon: string | null; txIds: Set<string> }>();
    for (const it of scoped) {
      const cat = it.transaction!.category;
      if (!cat) continue;
      const cur = map.get(cat.id) ?? { id: cat.id, name: cat.name, icon: cat.icon, txIds: new Set<string>() };
      cur.txIds.add(it.transaction!.id);
      map.set(cat.id, cur);
    }
    return [...map.values()]
      .map((c) => ({ id: c.id, name: c.name, icon: c.icon, count: c.txIds.size, grocery: isGrocery(c.name) }))
      .sort((a, b) => b.count - a.count);
  }, [scoped]);

  const hasGrocery = presentCategories.some((c) => c.grocery);
  // Fall back to "all" when the period has no grocery category, so the default
  // never shows an empty screen.
  const effectiveFilter = catFilter === 'grocery' && !hasGrocery ? 'all' : catFilter;

  const visible = useMemo(
    () =>
      scoped.filter((it) => {
        const cat = it.transaction!.category;
        if (effectiveFilter === 'all') return true;
        if (effectiveFilter === 'grocery') return !!cat && isGrocery(cat.name);
        return cat?.id === effectiveFilter;
      }),
    [scoped, effectiveFilter],
  );

  // Everything below works in ARS so USD purchases aggregate cleanly.
  const totalArs = useMemo(
    () => visible.reduce((s, it) => s + toArs(it.line_total, it.transaction!.currency), 0),
    [visible, toArs],
  );

  const byGroup = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of visible) {
      map.set(it.item_group, (map.get(it.item_group) ?? 0) + toArs(it.line_total, it.transaction!.currency));
    }
    return ITEM_GROUPS.map((g) => ({ g, total: map.get(g) ?? 0 }))
      .filter((x) => x.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [visible, toArs]);

  // Group items back into purchases (one card per transaction).
  const purchases = useMemo(() => {
    const map = new Map<string, { tx: NonNullable<SuperItem['transaction']>; count: number; sum: number }>();
    for (const it of visible) {
      const tx = it.transaction!;
      const cur = map.get(tx.id) ?? { tx, count: 0, sum: 0 };
      cur.count += 1;
      cur.sum += toArs(it.line_total, tx.currency);
      map.set(tx.id, cur);
    }
    return [...map.values()].sort((a, b) => b.tx.occurred_on.localeCompare(a.tx.occurred_on));
  }, [visible, toArs]);

  const rangeLabel = range === 'month' ? 'Este mes' : range === 'prev' ? 'Mes pasado' : 'Histórico';

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F9F5F0' }}>
      <header className="px-5 pt-14 pb-4 flex items-center gap-3">
        <Link href="/mas" className="text-2xl">←</Link>
        <div>
          <h1 className="text-2xl font-black" style={{ color: '#2D2D2D' }}>Compras de súper 🛒</h1>
          <p className="text-xs mt-0.5" style={{ color: '#6B6459' }}>Detalle de tus tickets escaneados</p>
        </div>
      </header>

      {/* Range filter */}
      <div className="px-4 mb-3 flex gap-2">
        {(['month', 'prev', 'all'] as const).map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className="px-3 py-1.5 rounded-full text-xs font-bold border"
            style={{
              background: range === r ? '#5BA886' : '#FFFFFF',
              borderColor: range === r ? '#5BA886' : '#ECE5DC',
              color: range === r ? '#FFFFFF' : '#6B6459',
            }}
          >
            {r === 'month' ? 'Este mes' : r === 'prev' ? 'Mes pasado' : 'Histórico'}
          </button>
        ))}
      </div>

      {/* Category filter — defaults to supermarket-type categories, with chips to
          switch to a specific one (e.g. cafés) or see all scanned purchases. */}
      {(presentCategories.length > 1 || (presentCategories.length === 1 && !presentCategories[0].grocery)) && (
        <div className="px-4 mb-3 flex gap-2 overflow-x-auto no-scrollbar">
          {hasGrocery && (
            <button
              onClick={() => setCatFilter('grocery')}
              className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border"
              style={{
                background: effectiveFilter === 'grocery' ? '#2D2D2D' : '#FFFFFF',
                borderColor: effectiveFilter === 'grocery' ? '#2D2D2D' : '#ECE5DC',
                color: effectiveFilter === 'grocery' ? '#FFFFFF' : '#6B6459',
              }}
            >
              🛒 Súper
            </button>
          )}
          {presentCategories
            .filter((c) => !c.grocery)
            .map((c) => (
              <button
                key={c.id}
                onClick={() => setCatFilter(c.id)}
                className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border"
                style={{
                  background: effectiveFilter === c.id ? '#2D2D2D' : '#FFFFFF',
                  borderColor: effectiveFilter === c.id ? '#2D2D2D' : '#ECE5DC',
                  color: effectiveFilter === c.id ? '#FFFFFF' : '#6B6459',
                }}
              >
                {c.icon ?? '🏷️'} {c.name}
              </button>
            ))}
          <button
            onClick={() => setCatFilter('all')}
            className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border"
            style={{
              background: effectiveFilter === 'all' ? '#2D2D2D' : '#FFFFFF',
              borderColor: effectiveFilter === 'all' ? '#2D2D2D' : '#ECE5DC',
              color: effectiveFilter === 'all' ? '#FFFFFF' : '#6B6459',
            }}
          >
            Todas
          </button>
        </div>
      )}

      <div className="px-4 flex flex-col gap-4">
        {isLoading ? (
          <div className="rounded-3xl p-8 text-center" style={{ background: '#FFFFFF' }}>
            <p className="text-3xl mb-2 animate-pulse">🛒</p>
            <p className="text-sm" style={{ color: '#6B6459' }}>Cargando…</p>
          </div>
        ) : purchases.length === 0 ? (
          <EmptyState
            icon="🛒"
            title="Sin compras con detalle"
            subtitle="Escaneá un ticket de súper y vas a ver acá el desglose por producto."
          />
        ) : (
          <>
            {/* Total spent */}
            <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
              <p className="text-xs font-semibold" style={{ color: '#6B6459' }}>Total en súper · {rangeLabel.toLowerCase()}</p>
              <p className="text-3xl font-black tabular-nums" style={{ color: '#FF7F6B' }}>{format(totalArs)}</p>
              <p className="text-xs mt-0.5" style={{ color: '#6B6459' }}>
                {purchases.length} compra{purchases.length !== 1 ? 's' : ''} · {visible.length} producto{visible.length !== 1 ? 's' : ''}
              </p>
            </div>

            {/* Spend by group */}
            <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
              <p className="text-xs font-bold uppercase tracking-wide mb-4" style={{ color: '#6B6459' }}>
                En qué se va la plata
              </p>
              <div className="flex flex-col gap-3.5">
                {byGroup.map(({ g, total }) => {
                  const meta = groupMeta(g);
                  const pct = totalArs > 0 ? Math.round((total / totalArs) * 100) : 0;
                  return (
                    <div key={g}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-sm">{meta.icon}</span>
                        <span className="text-sm capitalize flex-1 truncate" style={{ color: '#2D2D2D' }}>{g}</span>
                        <span className="text-[11px] font-semibold tabular-nums" style={{ color: '#A89B8C' }}>{pct}%</span>
                        <span className="text-sm font-bold tabular-nums" style={{ color: meta.color }}>{format(total)}</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#F1ECE4' }}>
                        <div className="h-full rounded-full" style={{ width: `${Math.max(pct, 3)}%`, background: meta.color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Purchases list */}
            <div>
              <p className="text-sm font-black mb-2 px-1" style={{ color: '#2D2D2D' }}>Compras</p>
              <div className="rounded-3xl overflow-hidden" style={{ background: '#FFFFFF' }}>
                {purchases.map((p, i) => (
                  <button
                    key={p.tx.id}
                    onClick={() => setOpenTx(p.tx)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
                    style={{ borderTop: i > 0 ? '1px solid #ECE5DC' : 'none' }}
                  >
                    <span className="text-2xl shrink-0">🧾</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: '#2D2D2D' }}>
                        {p.tx.merchant || 'Compra'}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: '#6B6459' }}>
                        {new Date(p.tx.occurred_on + 'T00:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })} · {p.count} producto{p.count !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <span className="text-base font-black tabular-nums shrink-0" style={{ color: '#FF7F6B' }}>
                      {format(toArs(p.tx.amount, p.tx.currency))}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <ReceiptItemsSheet
        open={!!openTx}
        onClose={() => setOpenTx(null)}
        householdId={profile.household_id}
        transactionId={openTx?.id ?? null}
        merchant={openTx?.merchant ?? null}
        total={openTx?.amount ?? 0}
        currency={openTx?.currency ?? 'ARS'}
        occurredOn={openTx?.occurred_on ?? curMonth + '-01'}
      />

      <BottomNav onFab={() => {}} />
    </div>
  );
}
