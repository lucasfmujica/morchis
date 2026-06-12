'use client';

import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { useFx } from '@/hooks/useFx';
import { BottomNav } from '@/components/BottomNav';
import { AddTransactionSheet } from '@/components/AddTransactionSheet';
import { SingleBars, lastSixMonths } from '@/components/MonthlyBars';
import { EmptyState } from '@/components/EmptyState';
import { formatARS } from '@/lib/format';
import { toLocalISO } from '@/lib/date';
import { myShareArs, type SplitRow } from '@/lib/budgets';
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
  currency: string;
  category_id: string | null;
  account_id: string | null;
  merchant: string | null;
  occurred_on: string;
  scope: string;
  is_shared: boolean;
  profile_id: string | null;
  splits: SplitRow[] | null;
  // Receipt item breakdown, fetched in the same query as a nested relation.
  items: { item_group: string; line_total: number; name: string; qty: number | null }[] | null;
};

export default function CategoryDetailClient({
  profile,
  category,
  partnerProfileId,
  partnerName,
  initialScope = 'all',
}: {
  profile: Profile;
  category: Category;
  partnerProfileId?: string;
  partnerName?: string;
  initialScope?: 'me' | 'all' | 'partner';
}) {
  const supabase = createClient();
  const { format, arsPerUsd } = useFx();
  const toArs = useCallback(
    (amount: number, currency: string) =>
      currency === 'USD' && arsPerUsd > 0 ? Math.round(amount * arsPerUsd) : amount,
    [arsPerUsd],
  );
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editTx, setEditTx] = useState<Tx | null>(null);
  // Whose movements to show, mirroring the "Gastos por categoría" breakdown so
  // opening a category from "Mío" keeps it personal. "all" = the whole household.
  const [scope, setScope] = useState<'me' | 'all' | 'partner'>(initialScope);
  const scopeProfileId = scope === 'me' ? profile.id : scope === 'partner' ? partnerProfileId : undefined;
  const scopeTabs = [
    { key: 'me' as const, label: 'Mío' },
    { key: 'all' as const, label: 'Nuestro' },
    ...(partnerProfileId ? [{ key: 'partner' as const, label: partnerName || 'Pareja' }] : []),
  ];
  // How much of a movement counts for the active scope, in ARS. "all" → the
  // full amount (household view); a person → their solo movements in full plus
  // their share of any shared expense (matches the breakdown / budgets math).
  const shareOf = useCallback(
    (t: Tx, pid: string | undefined): number => {
      if (!pid) return toArs(t.amount, t.currency);
      if (!t.is_shared) return t.profile_id === pid ? toArs(t.amount, t.currency) : 0;
      return myShareArs({ ...t, profile_id: t.profile_id ?? '' }, pid, arsPerUsd);
    },
    [toArs, arsPerUsd],
  );

  const months = useMemo(() => lastSixMonths(new Date()), []);
  const currentKey = months[months.length - 1].key;
  // Which month's transactions / item breakdown to show (tap a bar to drill in).
  const [selectedMonth, setSelectedMonth] = useState(currentKey);
  const rangeStart = `${months[0].key}-01`;
  // Cap at the end of the current month so future-dated installments (cuotas
  // booked for later months) don't inflate "Este mes" or the movements list.
  // Local date parts — toISOString flips to tomorrow after 21:00 in Argentina.
  const rangeEnd = useMemo(() => {
    const now = new Date();
    return toLocalISO(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  }, []);
  const accent = category.color || (category.kind === 'income' ? '#7EC8A4' : '#FF7F6B');

  const { data: txns = [] } = useQuery<Tx[]>({
    queryKey: ['category-tx', category.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('id, amount, type, currency, category_id, account_id, merchant, occurred_on, scope, is_shared, profile_id, splits(payer_profile_id, ower_profile_id, amount), items:transaction_items(item_group, line_total, name, qty)')
        .eq('household_id', profile.household_id)
        .eq('category_id', category.id)
        .gte('occurred_on', rangeStart)
        .lte('occurred_on', rangeEnd)
        .order('occurred_on', { ascending: false });
      return (data ?? []) as Tx[];
    },
  });

  // Active budget for this category, normalized to ARS (USD budgets converted at
  // the blue rate) so it lines up with the ARS-normalized monthly spend below.
  // This page has no scope toggle (the spend is household-wide), so only count
  // household budgets plus the viewer's own personal one — the partner's
  // personal budget would inflate the limit for a number they never set.
  const { data: budget = 0 } = useQuery<number>({
    queryKey: ['category-budget', category.id, profile.id, arsPerUsd],
    queryFn: async () => {
      const { data } = await supabase
        .from('budgets')
        .select('amount, currency, scope, profile_id')
        .eq('household_id', profile.household_id)
        .eq('category_id', category.id)
        .eq('active', true);
      return (data ?? [])
        .filter((b) => b.scope === 'household' || b.profile_id === profile.id)
        .reduce(
          (s, b) => s + (b.currency === 'USD' && arsPerUsd > 0 ? Math.round(b.amount * arsPerUsd) : b.amount),
          0,
        );
    },
  });

  // line_total is in the parent transaction's currency, so normalize to ARS
  // before summing (otherwise a USD receipt's items pollute the ARS totals).
  // Items now arrive nested on each transaction, so this needs no extra query.
  const groupTotals = useMemo(() => {
    const map = new Map<string, number>();
    // Per-group item list so tapping a group reveals what was actually bought.
    const itemsByGroup = new Map<string, { name: string; total: number; merchant: string }[]>();
    for (const t of txns) {
      if (!t.occurred_on.startsWith(selectedMonth)) continue;
      // Only count receipts that belong to the active scope.
      if (shareOf(t, scopeProfileId) <= 0) continue;
      for (const it of t.items ?? []) {
        const ars = toArs(it.line_total, t.currency);
        map.set(it.item_group, (map.get(it.item_group) ?? 0) + ars);
        const list = itemsByGroup.get(it.item_group) ?? [];
        list.push({ name: it.name, total: ars, merchant: t.merchant ?? '' });
        itemsByGroup.set(it.item_group, list);
      }
    }
    for (const list of itemsByGroup.values()) list.sort((a, b) => b.total - a.total);
    const total = [...map.values()].reduce((a, b) => a + b, 0);
    return { rows: [...map.entries()].map(([g, v]) => ({ g, v, pct: total > 0 ? v / total : 0 })).sort((a, b) => b.v - a.v), total, itemsByGroup };
  }, [txns, selectedMonth, toArs, shareOf, scopeProfileId]);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  // Deterministic purchase insights from receipt items: how each group moved
  // vs the previous month, and the single priciest item of the month.
  const purchaseInsights = useMemo(() => {
    const prevKey = (() => {
      const [y, m] = selectedMonth.split('-').map(Number);
      const d = new Date(y, m - 2, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    })();
    const prev = new Map<string, number>();
    for (const t of txns) {
      if (!t.occurred_on.startsWith(prevKey)) continue;
      if (shareOf(t, scopeProfileId) <= 0) continue;
      for (const it of t.items ?? []) prev.set(it.item_group, (prev.get(it.item_group) ?? 0) + toArs(it.line_total, t.currency));
    }
    const notes: string[] = [];
    for (const { g, v } of groupTotals.rows) {
      const before = prev.get(g) ?? 0;
      if (before <= 0) continue;
      const delta = (v - before) / before;
      // Only meaningful swings: ±25% and at least $2.000 of difference.
      if (Math.abs(delta) >= 0.25 && Math.abs(v - before) >= 2000) {
        notes.push(`${delta > 0 ? '📈' : '📉'} En ${g} gastaste ${Math.abs(Math.round(delta * 100))}% ${delta > 0 ? 'más' : 'menos'} que el mes pasado (${formatARS(before)} → ${formatARS(v)}).`);
      }
    }
    let top: { name: string; total: number } | null = null;
    for (const list of groupTotals.itemsByGroup.values()) {
      for (const it of list) if (!top || it.total > top.total) top = it;
    }
    if (top && top.total >= 5000) notes.push(`💸 Tu compra más cara fue ${top.name} (${formatARS(Math.round(top.total))}).`);
    return notes.slice(0, 4);
  }, [txns, selectedMonth, groupTotals, toArs, shareOf, scopeProfileId]);

  const GROUP_META: Record<string, { icon: string; color: string }> = {
    'frutas y verduras': { icon: '🥬', color: '#7EC8A4' },
    'carnes y fiambres': { icon: '🥩', color: '#E8806B' },
    'lácteos y huevos': { icon: '🥚', color: '#F2C94C' },
    almacén: { icon: '🫙', color: '#B5926B' },
    panadería: { icon: '🥖', color: '#D9A05B' },
    comida: { icon: '🍎', color: '#94BF8F' },
    bebidas: { icon: '🥤', color: '#6FA8DC' },
    snacks: { icon: '🍫', color: '#F5A623' },
    limpieza: { icon: '🧼', color: '#5C9CE6' },
    'cuidado personal': { icon: '🧴', color: '#E89AC7' },
    hogar: { icon: '🏠', color: '#B084CC' },
    mascotas: { icon: '🐾', color: '#A0855B' },
    otros: { icon: '🏷️', color: '#C4B9AE' },
  };

  // Price comparison across merchants from receipt items. Products are matched
  // by a normalized key (brand/packaging words stripped); produce ("frutas y
  // verduras") matches on the base product alone so "Banana Cavendish" (Coto)
  // and "Banana Ecuador" (Disco) land in the same bucket. Uses ALL months —
  // prices need history, not a month filter.
  const priceComparison = useMemo(() => {
    const STOP = new Set([
      'de', 'del', 'la', 'el', 'los', 'las', 'con', 'sin', 'para', 'al', 'en', 'por',
      'kg', 'g', 'gr', 'grm', 'ml', 'lt', 'ltr', 'cmq', 'un', 'uni', 'pet', 'bja', 'paq',
      'pot', 'tib', 'lat', 'blister', 'frasco', 'bandeja', 'bolsa', 'lata', 'botella',
      'granel', 'elegida', 'seleccion', 'fresca', 'fresco', 'pack', 'caja', 'desc', 'mixto',
    ]);
    const norm = (s: string) =>
      s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/\(.*?\)/g, ' ').replace(/[^a-z\s]/g, ' ')
        .split(/\s+/).filter((t) => t.length > 1 && !STOP.has(t));
    // $/kg when the receipt carries a weight (in the name or as fractional qty),
    // $/u otherwise. Comparing across different units would be meaningless.
    const unitPrice = (name: string, qty: number | null, totalArs: number): { value: number; unit: 'kg' | 'u' } | null => {
      const w = name.match(/(\d+[.,]\d+)\s*kg/i);
      if (w) {
        const kgs = parseFloat(w[1].replace(',', '.'));
        if (kgs > 0) return { value: totalArs / kgs, unit: 'kg' };
      }
      const q = Number(qty) || 1;
      if (q <= 0) return null;
      if (!Number.isInteger(q)) return { value: totalArs / q, unit: 'kg' };
      return { value: totalArs / q, unit: 'u' };
    };
    type Entry = { name: string; merchant: string; date: string; unit: 'kg' | 'u'; price: number };
    const buckets = new Map<string, Entry[]>();
    for (const t of txns) {
      if (!t.merchant) continue;
      for (const it of t.items ?? []) {
        const tokens = norm(it.name);
        if (tokens.length === 0) continue;
        const key = it.item_group === 'frutas y verduras' ? tokens[0] : tokens.slice(0, 2).join(' ');
        const up = unitPrice(it.name, it.qty, toArs(it.line_total, t.currency));
        if (!up) continue;
        const list = buckets.get(key) ?? [];
        list.push({ name: it.name, merchant: t.merchant, date: t.occurred_on, unit: up.unit, price: up.value });
        buckets.set(key, list);
      }
    }
    const rows: { key: string; unit: 'kg' | 'u'; entries: Entry[] }[] = [];
    for (const [key, entries] of buckets) {
      // Only comparable products: same unit, seen in 2+ different supermarkets.
      const unit = entries[0].unit;
      const sameUnit = entries.filter((e) => e.unit === unit);
      if (new Set(sameUnit.map((e) => e.merchant)).size < 2) continue;
      rows.push({ key, unit, entries: sameUnit.sort((a, b) => a.price - b.price) });
    }
    rows.sort((a, b) => b.entries.length - a.entries.length);
    // Which super wins most head-to-heads (cheapest entry per product).
    const wins = new Map<string, number>();
    for (const r of rows) wins.set(r.entries[0].merchant, (wins.get(r.entries[0].merchant) ?? 0) + 1);
    const winner = [...wins.entries()].sort((a, b) => b[1] - a[1])[0];
    return { rows, winner: winner ? { merchant: winner[0], count: winner[1], total: rows.length } : null };
  }, [txns, toArs]);

  const monthRows = useMemo(
    () =>
      months.map((m) => ({
        key: m.key,
        label: m.label,
        value: txns
          .filter((t) => t.occurred_on.startsWith(m.key))
          .reduce((s, t) => s + shareOf(t, scopeProfileId), 0),
      })),
    [months, txns, shareOf, scopeProfileId],
  );
  const thisMonth = monthRows[monthRows.length - 1].value;
  // Average over completed months only — the in-progress current month (shown
  // separately above) would drag the average down mid-month.
  const monthsWithData = monthRows.filter((r) => r.key !== currentKey && r.value > 0);
  const avg = monthsWithData.length > 0 ? Math.round(monthsWithData.reduce((s, r) => s + r.value, 0) / monthsWithData.length) : 0;
  const pct = budget > 0 ? thisMonth / budget : 0;
  const barCol = pct >= 1 ? '#FF7F6B' : pct >= 0.8 ? '#F5A623' : accent;

  const selectedMonthTx = txns.filter(
    (t) => t.occurred_on.startsWith(selectedMonth) && shareOf(t, scopeProfileId) > 0,
  );
  const selectedMonthLabel = months.find((m) => m.key === selectedMonth)?.label ?? '';
  const isCurrentMonth = selectedMonth === currentKey;

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

      {/* Scope toggle: Mío / Nuestro / pareja — only useful with a partner. */}
      {partnerProfileId && (
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
      )}

      <div className="px-4 flex flex-col gap-4">
        {/* Summary */}
        <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
          <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: '#6B6459' }}>Este mes</p>
          <p className="text-3xl font-black leading-none mb-1" style={{ color: accent, fontVariantNumeric: 'tabular-nums' }}>
            {formatARS(thisMonth)}
          </p>
          <p className="text-xs" style={{ color: '#6B6459' }}>Promedio 6 meses: {formatARS(avg)}</p>

          {budget > 0 && (
            <div className="mt-4">
              <div className="h-2.5 rounded-full overflow-hidden" style={{ background: '#ECE5DC' }}>
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(pct * 100, 100)}%`, background: barCol }} />
              </div>
              <div className="flex justify-between mt-1.5">
                <span className="text-xs font-bold" style={{ color: barCol }}>{Math.round(pct * 100)}% del presupuesto</span>
                <span className="text-xs" style={{ color: '#6B6459' }}>de {formatARS(budget)}</span>
              </div>
            </div>
          )}
        </div>

        {/* 6-month evolution — tap a bar to drill into that month */}
        <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
          <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: '#6B6459' }}>Evolución · 6 meses</p>
          <SingleBars rows={monthRows} color={accent} onSelect={setSelectedMonth} selectedKey={selectedMonth} />
        </div>

        {/* In what the money went — from scanned receipts */}
        {groupTotals.rows.length > 0 && (
          <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
            <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: '#6B6459' }}>
              En qué se fue · {isCurrentMonth ? 'este mes' : selectedMonthLabel}
            </p>
            <div className="flex flex-col gap-2.5">
              {groupTotals.rows.map(({ g, v, pct }) => {
                const meta = GROUP_META[g] ?? GROUP_META.otros;
                const isOpen = expandedGroup === g;
                const groupItems = groupTotals.itemsByGroup.get(g) ?? [];
                return (
                  <div key={g}>
                    <button
                      className="w-full text-left"
                      onClick={() => setExpandedGroup(isOpen ? null : g)}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span>{meta.icon}</span>
                        <span className="text-sm capitalize flex-1" style={{ color: '#2D2D2D' }}>{g}</span>
                        <span className="text-xs font-semibold" style={{ color: '#6B6459' }}>{Math.round(pct * 100)}%</span>
                        <span className="text-sm font-bold w-24 text-right" style={{ color: meta.color }}>{formatARS(v)}</span>
                        <span className="text-[10px]" style={{ color: '#6B6459' }}>{isOpen ? '▲' : '▼'}</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#ECE5DC' }}>
                        <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, background: meta.color }} />
                      </div>
                    </button>
                    {isOpen && (
                      <div className="mt-1.5 mb-1 pl-7 flex flex-col gap-1">
                        {groupItems.map((it, i) => (
                          <div key={i} className="flex items-baseline gap-2">
                            <span className="text-xs flex-1 truncate" style={{ color: '#6B6459' }}>{it.name}</span>
                            {it.merchant && <span className="text-[10px] shrink-0" style={{ color: '#C4B9AE' }}>{it.merchant}</span>}
                            <span className="text-xs font-semibold shrink-0" style={{ color: '#2D2D2D' }}>{formatARS(Math.round(it.total))}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] mt-3" style={{ color: '#6B6459' }}>Detalle según tickets escaneados 🧾 · Tocá un grupo para ver los productos</p>
            {purchaseInsights.length > 0 && (
              <div className="mt-3 pt-3 flex flex-col gap-1.5" style={{ borderTop: '1px solid #ECE5DC' }}>
                <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#6B6459' }}>Insights 🧠</p>
                {purchaseInsights.map((n, i) => (
                  <p key={i} className="text-xs leading-relaxed" style={{ color: '#2D2D2D' }}>{n}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Price comparison across supermarkets, from repeated receipt items */}
        {priceComparison.rows.length > 0 && (
          <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
            <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: '#6B6459' }}>
              ¿Dónde conviene comprar?
            </p>
            {priceComparison.winner && priceComparison.winner.total > 1 && (
              <p className="text-sm font-bold mb-3" style={{ color: '#2D2D2D' }}>
                🏆 {priceComparison.winner.merchant} fue más barato en {priceComparison.winner.count} de {priceComparison.winner.total} productos comparables
              </p>
            )}
            <div className="flex flex-col gap-3">
              {priceComparison.rows.map((r) => (
                <div key={r.key}>
                  <p className="text-sm font-semibold capitalize mb-1" style={{ color: '#2D2D2D' }}>{r.key}</p>
                  {r.entries.map((e, i) => (
                    <div key={`${e.merchant}-${e.date}-${i}`} className="flex items-center gap-2 py-0.5">
                      <span className="text-xs flex-1 truncate" style={{ color: '#6B6459' }}>
                        {i === 0 ? '✅ ' : ''}{e.merchant} · {fmtDate(e.date)}
                      </span>
                      <span className="text-xs font-bold" style={{ color: i === 0 ? '#7EC8A4' : '#6B6459' }}>
                        {formatARS(Math.round(e.price))}/{r.unit}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <p className="text-[11px] mt-3" style={{ color: '#6B6459' }}>
              Precio por {`kg o unidad`} según tickets escaneados. Se compara el mismo producto entre supermercados.
            </p>
          </div>
        )}

        {/* Selected month's movements */}
        <div>
          <p className="text-sm font-black mb-2 px-1" style={{ color: '#2D2D2D' }}>
            Movimientos de {isCurrentMonth ? 'este mes' : selectedMonthLabel}
          </p>
          {selectedMonthTx.length === 0 ? (
            <EmptyState icon={category.icon} title="Sin movimientos" subtitle={`No hay registros en esta categoría en ${isCurrentMonth ? 'este mes' : selectedMonthLabel}.`} />
          ) : (
            <div className="rounded-3xl overflow-hidden" style={{ background: '#FFFFFF' }}>
              {selectedMonthTx.map((tx, i) => (
                <button
                  key={tx.id}
                  onClick={() => { setEditTx(tx); setSheetOpen(true); }}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
                  style={{ borderTop: i > 0 ? '1px solid #ECE5DC' : 'none' }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: '#2D2D2D' }}>{tx.merchant || category.name}</p>
                    <p className="text-xs" style={{ color: '#6B6459' }}>{fmtDate(tx.occurred_on)}{tx.is_shared ? ' · compartido' : ''}</p>
                  </div>
                  <p className="text-base font-black" style={{ color: tx.type === 'expense' ? '#FF7F6B' : '#7EC8A4' }}>
                    {tx.type === 'expense' ? '-' : '+'}{format(shareOf(tx, scopeProfileId))}
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
