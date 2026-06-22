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

type Tx = {
  id: string;
  merchant: string | null;
  occurred_on: string;
  currency: string;
  amount: number;
  scope: string;
  profile_id: string;
};

type ItemRow = {
  id: string;
  transaction_id: string;
  name: string;
  qty: number | null;
  line_total: number;
  item_group: string;
};

type Range = 'month' | 'prev' | 'all';

// Accent-insensitive normalisation for grocery-category detection.
function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
// Which categories count as "súper" — supermarket, almacén, greengrocer,
// butcher, etc. (the water *utility* "Agua" is intentionally excluded; bottled
// water bought at the súper lives inside a grocery purchase).
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
  // Tapped purchase → opens the editable per-purchase detail sheet.
  const [openTx, setOpenTx] = useState<Tx | null>(null);
  // Tapped breakdown group → drill into the individual items in that rubro.
  const [drillGroup, setDrillGroup] = useState<string | null>(null);

  // Grocery category ids (so the transaction query can filter server-side).
  const { data: groceryIds = [] } = useQuery<string[]>({
    queryKey: ['grocery-category-ids', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('categories')
        .select('id, name, kind')
        .eq('household_id', profile.household_id)
        .eq('kind', 'expense');
      return (data ?? []).filter((c) => isGrocery(c.name)).map((c) => c.id);
    },
  });

  // ALL grocery-category expenses (scanned or manual) — this is what makes the
  // total real instead of "only the scanned tickets".
  const { data: txs = [], isLoading } = useQuery<Tx[]>({
    queryKey: ['super-tx', profile.household_id, groceryIds],
    enabled: groceryIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('id, merchant, occurred_on, currency, amount, scope, profile_id')
        .eq('household_id', profile.household_id)
        .eq('type', 'expense')
        .in('category_id', groceryIds)
        .order('occurred_on', { ascending: false });
      return (data as Tx[]) ?? [];
    },
  });

  // Scanned line-items for the household, used for the food-group breakdown and
  // to tell which purchases have detail.
  const { data: itemRows = [] } = useQuery<ItemRow[]>({
    // 'v2' busts any stale cache from the earlier query shape that didn't select
    // `name` (a 5-min staleTime was serving it as "Sin nombre"). The invalidation
    // in ReceiptItemsSheet uses the ['super-items'] prefix, so it still matches.
    queryKey: ['super-items', profile.household_id, 'v2'],
    queryFn: async () => {
      const { data } = await supabase
        .from('transaction_items')
        .select('id, transaction_id, name, qty, line_total, item_group')
        .eq('household_id', profile.household_id);
      return (data as ItemRow[]) ?? [];
    },
  });

  const now = new Date();
  const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

  // Visibility (same rule as /movimientos) + period filter.
  const visible = useMemo(
    () =>
      txs.filter((tx) => {
        if (!(tx.scope === 'household' || tx.profile_id === profile.id)) return false;
        if (range === 'month') return tx.occurred_on.startsWith(curMonth);
        if (range === 'prev') return tx.occurred_on.startsWith(prevMonth);
        return true;
      }),
    [txs, range, profile.id, curMonth, prevMonth],
  );

  // Items grouped by transaction (only for the visible grocery purchases).
  const itemsByTx = useMemo(() => {
    const visibleIds = new Set(visible.map((t) => t.id));
    const map = new Map<string, ItemRow[]>();
    for (const r of itemRows) {
      if (!visibleIds.has(r.transaction_id)) continue;
      const arr = map.get(r.transaction_id) ?? [];
      arr.push(r);
      map.set(r.transaction_id, arr);
    }
    return map;
  }, [itemRows, visible]);

  // Top-line total: ALL grocery spend in the period (scanned + manual).
  const totalArs = useMemo(
    () => visible.reduce((s, tx) => s + toArs(tx.amount, tx.currency), 0),
    [visible, toArs],
  );

  // How much of that total is actually itemised (drives the coverage note).
  const scanned = useMemo(() => {
    const withItems = visible.filter((tx) => itemsByTx.has(tx.id));
    return {
      count: withItems.length,
      amount: withItems.reduce((s, tx) => s + toArs(tx.amount, tx.currency), 0),
    };
  }, [visible, itemsByTx, toArs]);

  // Food-group breakdown over the scanned items only (the only ones with detail).
  const byGroup = useMemo(() => {
    const map = new Map<string, number>();
    let sum = 0;
    for (const tx of visible) {
      const rows = itemsByTx.get(tx.id);
      if (!rows) continue;
      for (const r of rows) {
        const ars = toArs(Number(r.line_total), tx.currency);
        map.set(r.item_group, (map.get(r.item_group) ?? 0) + ars);
        sum += ars;
      }
    }
    const groups = ITEM_GROUPS.map((g) => ({ g, total: map.get(g) ?? 0 }))
      .filter((x) => x.total > 0)
      .sort((a, b) => b.total - a.total);
    return { groups, sum };
  }, [visible, itemsByTx, toArs]);

  // Individual items grouped by rubro (for the drill-down), each carrying the
  // purchase it came from. Built over the same visible+itemised set.
  const itemsByGroup = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; qty: number | null; ars: number; merchant: string | null; occurred_on: string }[]
    >();
    for (const tx of visible) {
      const rows = itemsByTx.get(tx.id);
      if (!rows) continue;
      for (const r of rows) {
        const arr = map.get(r.item_group) ?? [];
        arr.push({
          id: r.id,
          name: r.name,
          qty: r.qty,
          ars: toArs(Number(r.line_total), tx.currency),
          merchant: tx.merchant,
          occurred_on: tx.occurred_on,
        });
        map.set(r.item_group, arr);
      }
    }
    for (const arr of map.values()) arr.sort((a, b) => b.ars - a.ars);
    return map;
  }, [visible, itemsByTx, toArs]);

  // One card per purchase (newest first), with its item count.
  const purchases = useMemo(
    () =>
      [...visible]
        .map((tx) => ({ tx, count: itemsByTx.get(tx.id)?.length ?? 0 }))
        .sort((a, b) => b.tx.occurred_on.localeCompare(a.tx.occurred_on)),
    [visible, itemsByTx],
  );

  const rangeLabel = range === 'month' ? 'este mes' : range === 'prev' ? 'mes pasado' : 'histórico';
  const coveragePct = totalArs > 0 ? Math.round((scanned.amount / totalArs) * 100) : 0;

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F9F5F0' }}>
      <header className="px-5 pt-14 pb-4 flex items-center gap-3">
        <Link href="/mas" className="text-2xl">←</Link>
        <div>
          <h1 className="text-2xl font-black" style={{ color: '#2D2D2D' }}>Compras de súper 🛒</h1>
          <p className="text-xs mt-0.5" style={{ color: '#6B6459' }}>Todo lo de tu categoría de súper</p>
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

      <div className="px-4 flex flex-col gap-4">
        {isLoading ? (
          <div className="rounded-3xl p-8 text-center" style={{ background: '#FFFFFF' }}>
            <p className="text-3xl mb-2 animate-pulse">🛒</p>
            <p className="text-sm" style={{ color: '#6B6459' }}>Cargando…</p>
          </div>
        ) : purchases.length === 0 ? (
          <EmptyState
            icon="🛒"
            title="Sin compras de súper"
            subtitle="No hay gastos de tu categoría de súper en este período."
          />
        ) : (
          <>
            {/* Total — ALL grocery spend (scanned + manual) */}
            <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
              <p className="text-xs font-semibold" style={{ color: '#6B6459' }}>Total en súper · {rangeLabel}</p>
              <p className="text-3xl font-black tabular-nums" style={{ color: '#FF7F6B' }}>{format(totalArs)}</p>
              <p className="text-xs mt-0.5" style={{ color: '#6B6459' }}>
                {purchases.length} compra{purchases.length !== 1 ? 's' : ''} · {scanned.count} con detalle
              </p>
            </div>

            {/* Group breakdown — scanned items only, with a coverage note */}
            {byGroup.groups.length > 0 ? (
              <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
                <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#6B6459' }}>
                  En qué se va la plata
                </p>
                <p className="text-[11px] mb-4 mt-0.5" style={{ color: '#A89B8C' }}>
                  Desglose de lo escaneado: {format(scanned.amount)} de {format(totalArs)} ({coveragePct}%).
                  {coveragePct < 100 && ' El resto son compras sin ticket escaneado.'}
                </p>
                <div className="flex flex-col gap-3.5">
                  {byGroup.groups.map(({ g, total }) => {
                    const meta = groupMeta(g);
                    const pct = byGroup.sum > 0 ? Math.round((total / byGroup.sum) * 100) : 0;
                    const n = itemsByGroup.get(g)?.length ?? 0;
                    return (
                      <button key={g} onClick={() => setDrillGroup(g)} className="text-left w-full">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-sm">{meta.icon}</span>
                          <span className="text-sm capitalize flex-1 truncate" style={{ color: '#2D2D2D' }}>{g}</span>
                          <span className="text-[11px] font-semibold tabular-nums" style={{ color: '#A89B8C' }}>{pct}%</span>
                          <span className="text-sm font-bold tabular-nums" style={{ color: meta.color }}>{format(total)}</span>
                          <span className="text-xs" style={{ color: '#C4B9AE' }}>›</span>
                        </div>
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#F1ECE4' }}>
                          <div className="h-full rounded-full" style={{ width: `${Math.max(pct, 3)}%`, background: meta.color }} />
                        </div>
                        <p className="text-[10px] mt-1" style={{ color: '#C4B9AE' }}>{n} producto{n !== 1 ? 's' : ''} · tocá para ver</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
                <p className="text-sm font-bold mb-1" style={{ color: '#2D2D2D' }}>Sin desglose por producto</p>
                <p className="text-xs" style={{ color: '#6B6459' }}>
                  Ninguna compra de este período tiene ticket escaneado. Escaneá tus tickets de súper para ver en qué se va la plata (carnes, verduras, etc.).
                </p>
              </div>
            )}

            {/* Purchases list — all of them; manual ones flagged "sin detalle" */}
            <div>
              <p className="text-sm font-black mb-2 px-1" style={{ color: '#2D2D2D' }}>Compras</p>
              <div className="rounded-3xl overflow-hidden" style={{ background: '#FFFFFF' }}>
                {purchases.map(({ tx, count }, i) => (
                  <button
                    key={tx.id}
                    onClick={() => setOpenTx(tx)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
                    style={{ borderTop: i > 0 ? '1px solid #ECE5DC' : 'none' }}
                  >
                    <span className="text-2xl shrink-0">🧾</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: '#2D2D2D' }}>
                        {tx.merchant || 'Compra'}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-xs" style={{ color: '#6B6459' }}>
                          {new Date(tx.occurred_on + 'T00:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}
                        </span>
                        {count > 0 ? (
                          <span className="text-xs" style={{ color: '#6B6459' }}>· {count} producto{count !== 1 ? 's' : ''}</span>
                        ) : (
                          <span className="text-[11px] px-1.5 py-0.5 rounded-md font-semibold" style={{ background: '#F1ECE4', color: '#A89B8C' }}>
                            sin detalle
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-base font-black tabular-nums shrink-0" style={{ color: '#FF7F6B' }}>
                      {format(toArs(tx.amount, tx.currency))}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Drill-down: all items in a tapped rubro, across the period's purchases */}
      {drillGroup && (() => {
        const list = itemsByGroup.get(drillGroup) ?? [];
        const meta = groupMeta(drillGroup);
        const groupTotal = list.reduce((s, it) => s + it.ars, 0);
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center" style={{ background: 'rgba(45,45,45,0.4)' }} onClick={() => setDrillGroup(null)}>
            <div
              className="w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl p-6 max-h-[78vh] overflow-y-auto"
              style={{ background: '#FFFFFF', paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: '#ECE5DC' }} />
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">{meta.icon}</span>
                <h2 className="text-lg font-black capitalize flex-1" style={{ color: '#2D2D2D' }}>{drillGroup}</h2>
                <span className="text-lg font-black tabular-nums" style={{ color: meta.color }}>{format(groupTotal)}</span>
              </div>
              <p className="text-xs mb-4" style={{ color: '#6B6459' }}>
                {list.length} producto{list.length !== 1 ? 's' : ''} · {rangeLabel}
              </p>
              <div className="flex flex-col">
                {list.map((it, i) => (
                  <div
                    key={it.id}
                    className="flex items-center gap-3 py-2.5"
                    style={{ borderTop: i > 0 ? '1px solid #F1ECE4' : 'none' }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate" style={{ color: '#2D2D2D' }}>
                        {it.qty && it.qty > 1 ? `${it.qty}× ` : ''}{it.name || 'Sin nombre'}
                      </p>
                      <p className="text-[11px] truncate" style={{ color: '#A89B8C' }}>
                        {it.merchant || 'Compra'} · {new Date(it.occurred_on + 'T00:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}
                      </p>
                    </div>
                    <span className="text-sm font-bold tabular-nums shrink-0" style={{ color: '#2D2D2D' }}>{format(it.ars)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

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
