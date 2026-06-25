'use client';

import { useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { useFx } from '@/hooks/useFx';
import { BottomNav } from '@/components/BottomNav';
import { EmptyState } from '@/components/EmptyState';
import { ReceiptItemsSheet } from '@/components/ReceiptItemsSheet';
import { groupMeta } from '@/lib/itemGroups';

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

// Accent-insensitive normalisation.
function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
// Which expense categories count as "café" — cafeterías and coffee shops.
function isCafe(name: string): boolean {
  return /cafeter|\bcafe\b|cafe$|café/.test(norm(name));
}
// Canonical key for a product so "Latte", "latte" and "Latte " all match.
function prodKey(s: string): string {
  return norm(s).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
// Tips, cover charges and bags aren't products to compare.
function isNonProduct(name: string): boolean {
  return /propina|cubierto|^bolsa|servicio de mesa/.test(norm(name));
}
// A tip logged as its OWN café expense ("Propina Ada Cafe" / "Propón café
// rosie"), separate from the consumption ticket. These get folded into their
// café's visit so the visit/place total is the real amount paid.
function isTipTx(merchant: string | null): boolean {
  return /^prop(ina|on)\b/.test(norm(merchant ?? ''));
}
// Significant name tokens of a place (drops tip/café filler + connectors), used
// to match a tip back to its consumption ticket of the same day.
const PLACE_STOP = new Set(['propina', 'propon', 'cafe', 'cafes', 'cafeteria', 'del', 'con']);
function placeTokens(merchant: string | null): Set<string> {
  return new Set(
    norm(merchant ?? '')
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !PLACE_STOP.has(w)),
  );
}

export default function CafesClient({ profile }: { profile: Profile }) {
  const supabase = createClient();
  const { format, arsPerUsd } = useFx();
  const toArs = useCallback(
    (amount: number, currency: string) =>
      currency === 'USD' && arsPerUsd > 0 ? Math.round(amount * arsPerUsd) : amount,
    [arsPerUsd],
  );

  // Default to the full history — price comparison needs as many data points as
  // possible, and cafés are low-ticket so a single month is usually thin.
  const [range, setRange] = useState<Range>('all');
  const [openTx, setOpenTx] = useState<Tx | null>(null);
  // Tapped product → opens the "where is it cheapest" comparison sheet.
  const [openProduct, setOpenProduct] = useState<string | null>(null);

  const { data: cafeIds = [] } = useQuery<string[]>({
    queryKey: ['cafe-category-ids', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('categories')
        .select('id, name, kind')
        .eq('household_id', profile.household_id)
        .eq('kind', 'expense');
      return (data ?? []).filter((c) => isCafe(c.name)).map((c) => c.id);
    },
  });

  const { data: txs = [], isLoading } = useQuery<Tx[]>({
    queryKey: ['cafe-tx', profile.household_id, cafeIds],
    enabled: cafeIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('id, merchant, occurred_on, currency, amount, scope, profile_id')
        .eq('household_id', profile.household_id)
        .eq('type', 'expense')
        .in('category_id', cafeIds)
        .order('occurred_on', { ascending: false });
      return (data as Tx[]) ?? [];
    },
  });

  const { data: itemRows = [] } = useQuery<ItemRow[]>({
    // Shares the ['cafe-items'] prefix so ReceiptItemsSheet's invalidation hits it.
    queryKey: ['cafe-items', profile.household_id, 'v1'],
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

  // Fold standalone tip tickets into their café's consumption visit of the same
  // day (matched by shared name tokens), so each visit's total is what was
  // actually paid and tips stop showing up as phantom separate cafés. The grand
  // total is unchanged — the tip just moves onto its visit. `tipByTxId` is the
  // tip amount (native currency) folded into each consumption tx; `displayTxs`
  // drops the absorbed tip tickets (an unmatched tip stays as its own row).
  const { displayTxs, tipByTxId } = useMemo(() => {
    const tips = visible.filter((t) => isTipTx(t.merchant));
    const nonTips = visible.filter((t) => !isTipTx(t.merchant));
    const tipByTxId = new Map<string, number>();
    const absorbed = new Set<string>();
    for (const tip of tips) {
      const wanted = placeTokens(tip.merchant);
      let best: { tx: Tx; score: number } | null = null;
      for (const tx of nonTips) {
        if (tx.occurred_on !== tip.occurred_on || tx.currency !== tip.currency) continue;
        let score = 0;
        const toks = placeTokens(tx.merchant);
        for (const w of wanted) if (toks.has(w)) score += 1;
        if (score > 0 && (!best || score > best.score || (score === best.score && tx.amount > best.tx.amount))) {
          best = { tx, score };
        }
      }
      if (best) {
        tipByTxId.set(best.tx.id, (tipByTxId.get(best.tx.id) ?? 0) + tip.amount);
        absorbed.add(tip.id);
      }
    }
    return { displayTxs: visible.filter((t) => !absorbed.has(t.id)), tipByTxId };
  }, [visible]);

  // Real visit total in ARS: the ticket plus any tip folded into it.
  const visitArs = useCallback(
    (tx: Tx) => toArs(tx.amount + (tipByTxId.get(tx.id) ?? 0), tx.currency),
    [toArs, tipByTxId],
  );

  const itemsByTx = useMemo(() => {
    const visibleIds = new Set(displayTxs.map((t) => t.id));
    const map = new Map<string, ItemRow[]>();
    for (const r of itemRows) {
      if (!visibleIds.has(r.transaction_id)) continue;
      const arr = map.get(r.transaction_id) ?? [];
      arr.push(r);
      map.set(r.transaction_id, arr);
    }
    return map;
  }, [itemRows, displayTxs]);

  const totalArs = useMemo(
    () => displayTxs.reduce((s, tx) => s + visitArs(tx), 0),
    [displayTxs, visitArs],
  );

  // Product comparison: same product across cafés, averaged per café (so two
  // visits to the same place don't double-count), cheapest first.
  type Product = {
    key: string;
    name: string;
    group: string;
    count: number;
    merchants: { merchant: string; unit: number; times: number }[];
    min: { merchant: string; unit: number; times: number };
    max: { merchant: string; unit: number; times: number };
  };
  const products = useMemo<Product[]>(() => {
    const map = new Map<string, { names: Map<string, number>; group: string; byMerchant: Map<string, { sum: number; n: number }> }>();
    for (const tx of displayTxs) {
      const rows = itemsByTx.get(tx.id);
      if (!rows) continue;
      const merchant = tx.merchant?.trim() || 'Sin nombre';
      for (const r of rows) {
        const nm = (r.name || '').trim();
        if (!nm || isNonProduct(nm)) continue;
        const key = prodKey(nm);
        if (!key) continue;
        const qty = r.qty && Number(r.qty) > 0 ? Number(r.qty) : 1;
        const unit = toArs(Number(r.line_total), tx.currency) / qty;
        const e = map.get(key) ?? { names: new Map<string, number>(), group: r.item_group, byMerchant: new Map() };
        e.names.set(nm, (e.names.get(nm) ?? 0) + 1);
        const m = e.byMerchant.get(merchant) ?? { sum: 0, n: 0 };
        m.sum += unit;
        m.n += 1;
        e.byMerchant.set(merchant, m);
        map.set(key, e);
      }
    }
    return [...map.entries()]
      .map(([key, e]) => {
        let name = '';
        let best = -1;
        for (const [n, c] of e.names) if (c > best) { best = c; name = n; }
        const merchants = [...e.byMerchant.entries()]
          .map(([merchant, v]) => ({ merchant, unit: v.sum / v.n, times: v.n }))
          .sort((a, b) => a.unit - b.unit);
        const count = merchants.reduce((s, m) => s + m.times, 0);
        return { key, name, group: e.group, count, merchants, min: merchants[0], max: merchants[merchants.length - 1] };
      })
      .sort((a, b) => b.merchants.length - a.merchants.length || b.count - a.count || a.name.localeCompare(b.name));
  }, [displayTxs, itemsByTx, toArs]);

  // Café ranking — total spend & visits per place (tips folded into the visit).
  const cafes = useMemo(() => {
    const m = new Map<string, { total: number; visits: number }>();
    for (const tx of displayTxs) {
      const k = tx.merchant?.trim() || 'Sin nombre';
      const e = m.get(k) ?? { total: 0, visits: 0 };
      e.total += visitArs(tx);
      e.visits += 1;
      m.set(k, e);
    }
    const rows = [...m.entries()].map(([merchant, v]) => ({ merchant, ...v })).sort((a, b) => b.total - a.total);
    return { rows, max: Math.max(1, ...rows.map((r) => r.total)) };
  }, [displayTxs, visitArs]);

  const purchases = useMemo(
    () =>
      [...displayTxs]
        .map((tx) => ({ tx, count: itemsByTx.get(tx.id)?.length ?? 0 }))
        .sort((a, b) => b.tx.occurred_on.localeCompare(a.tx.occurred_on)),
    [displayTxs, itemsByTx],
  );

  const comparable = products.filter((p) => p.merchants.length > 1).length;
  const rangeLabel = range === 'month' ? 'este mes' : range === 'prev' ? 'mes pasado' : 'histórico';
  const sel = openProduct ? products.find((p) => p.key === openProduct) ?? null : null;

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F1F5F3' }}>
      <header className="px-5 pt-14 pb-4 flex items-center gap-3">
        <Link href="/mas" className="text-2xl">←</Link>
        <div>
          <h1 className="text-2xl font-black" style={{ color: '#18211D' }}>Cafés ☕</h1>
          <p className="text-xs mt-0.5" style={{ color: '#5B6660' }}>Compará precios entre cafeterías</p>
        </div>
      </header>

      {/* Range filter */}
      <div className="px-4 mb-3 flex gap-2">
        {(['all', 'month', 'prev'] as const).map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className="px-3 py-2 rounded-full text-xs font-bold border transition-all"
            style={{
              background: range === r ? '#6F4E37' : '#FFFFFF',
              borderColor: range === r ? '#6F4E37' : '#E5EBE8',
              color: range === r ? '#FFFFFF' : '#5B6660',
              boxShadow: range === r ? '0 4px 12px -4px rgba(111,78,55,0.55)' : 'var(--shadow-soft)',
            }}
          >
            {r === 'month' ? 'Este mes' : r === 'prev' ? 'Mes pasado' : 'Histórico'}
          </button>
        ))}
      </div>

      <div className="px-4 flex flex-col gap-4">
        {isLoading ? (
          <div className="rounded-3xl p-8 text-center" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
            <p className="text-3xl mb-2 animate-pulse">☕</p>
            <p className="text-sm" style={{ color: '#5B6660' }}>Cargando…</p>
          </div>
        ) : purchases.length === 0 ? (
          <EmptyState
            icon="☕"
            title="Sin cafés todavía"
            subtitle="No hay gastos de tu categoría de cafeterías en este período."
          />
        ) : (
          <>
            {/* Total */}
            <div className="rounded-3xl overflow-hidden" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-pop)' }}>
              <div className="relative px-5 pt-5 pb-5 overflow-hidden" style={{ background: 'linear-gradient(135deg, #8A6B52 0%, #6F4E37 100%)' }}>
                <div className="absolute -top-10 -right-8 w-40 h-40 rounded-full pointer-events-none" style={{ background: 'rgba(255,255,255,0.14)' }} />
                <p className="relative text-[11px] font-black uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.82)' }}>Total en cafés · {rangeLabel}</p>
                <p className="relative text-[2.4rem] leading-none font-black mt-2 tracking-tight" style={{ color: '#FFFFFF', fontVariantNumeric: 'tabular-nums' }}>{format(totalArs)}</p>
                <p className="relative text-[11px] mt-2" style={{ color: 'rgba(255,255,255,0.85)' }}>
                  {cafes.rows.length} café{cafes.rows.length !== 1 ? 's' : ''} · {products.length} producto{products.length !== 1 ? 's' : ''} con detalle
                </p>
              </div>
            </div>

            {/* Product comparator */}
            {products.length > 0 ? (
              <div className="rounded-3xl p-5" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
                <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#5B6660' }}>Comparador de productos</p>
                <p className="text-[11px] mb-4 mt-0.5" style={{ color: '#8C968F' }}>
                  {comparable > 0
                    ? `${comparable} producto${comparable !== 1 ? 's' : ''} en más de un café. Tocá para ver dónde está más barato.`
                    : 'Escaneá tickets de distintos cafés para comparar el mismo producto.'}
                </p>
                <div className="flex flex-col gap-1">
                  {products.map((p) => {
                    const meta = groupMeta(p.group);
                    const multi = p.merchants.length > 1;
                    return (
                      <button
                        key={p.key}
                        onClick={() => setOpenProduct(p.key)}
                        className="text-left w-full -mx-2 px-2 py-2 rounded-2xl transition-colors hover:bg-[#F4F8F6] active:bg-[#EEF3F1]"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="text-lg shrink-0">{meta.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-semibold truncate" style={{ color: '#18211D' }}>{p.name}</span>
                              <span className="text-sm font-black tabular-nums shrink-0" style={{ color: '#18211D' }}>
                                {multi ? `${format(Math.round(p.min.unit))}–${format(Math.round(p.max.unit))}` : format(Math.round(p.min.unit))}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2 mt-0.5">
                              <span className="text-[11px] truncate" style={{ color: multi ? '#1F8A68' : '#8C968F' }}>
                                {multi ? `más barato en ${p.min.merchant}` : `${p.min.merchant} · ${p.count} vez${p.count !== 1 ? 'es' : ''}`}
                              </span>
                              <span className="text-[11px] shrink-0" style={{ color: '#B0BAB4' }}>
                                {p.merchants.length} café{p.merchants.length !== 1 ? 's' : ''} ›
                              </span>
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="rounded-3xl p-5" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
                <p className="text-sm font-bold mb-1" style={{ color: '#18211D' }}>Sin productos para comparar</p>
                <p className="text-xs" style={{ color: '#5B6660' }}>
                  Ninguna compra de este período tiene ticket escaneado. Escaneá tus tickets de café (con el 🧾) para comparar el precio del latte, el tostado, etc. entre cafeterías.
                </p>
              </div>
            )}

            {/* Café ranking */}
            {cafes.rows.length > 1 && (
              <div className="rounded-3xl p-5" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
                <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: '#5B6660' }}>Tus cafés · {rangeLabel}</p>
                <div className="flex flex-col gap-2.5">
                  {cafes.rows.slice(0, 8).map((c) => (
                    <div key={c.merchant}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-semibold truncate" style={{ color: '#18211D' }}>{c.merchant}</span>
                        <span className="text-sm font-black tabular-nums ml-2 shrink-0" style={{ color: '#18211D' }}>{format(c.total)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#EFE7E0' }}>
                          <div className="h-full rounded-full" style={{ width: `${Math.max((c.total / cafes.max) * 100, 3)}%`, background: '#8A6B52' }} />
                        </div>
                        <span className="text-[11px] tabular-nums shrink-0" style={{ color: '#8C968F' }}>{c.visits} visita{c.visits !== 1 ? 's' : ''}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tickets list */}
            <div>
              <p className="text-sm font-black mb-2 px-1" style={{ color: '#18211D' }}>Tickets</p>
              <div className="rounded-3xl overflow-hidden" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
                {purchases.map(({ tx, count }, i) => (
                  <button
                    key={tx.id}
                    onClick={() => setOpenTx(tx)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[#F4F8F6] active:bg-[#EEF3F1]"
                    style={{ borderTop: i > 0 ? '1px solid #E5EBE8' : 'none' }}
                  >
                    <span className="text-2xl shrink-0">☕</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: '#18211D' }}>{tx.merchant || 'Café'}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-xs" style={{ color: '#5B6660' }}>
                          {new Date(tx.occurred_on + 'T00:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}
                        </span>
                        {count > 0 ? (
                          <span className="text-xs" style={{ color: '#5B6660' }}>· {count} producto{count !== 1 ? 's' : ''}</span>
                        ) : (
                          <span className="text-[11px] px-1.5 py-0.5 rounded-md font-semibold" style={{ background: '#EAF0ED', color: '#8C968F' }}>
                            sin detalle
                          </span>
                        )}
                        {(tipByTxId.get(tx.id) ?? 0) > 0 && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded-md font-semibold" style={{ background: '#EFE7E0', color: '#6F4E37' }}>
                            + propina
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-base font-black tabular-nums shrink-0" style={{ color: '#6F4E37' }}>
                      {format(visitArs(tx))}
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-[11px] mt-2 px-1" style={{ color: '#8C968F' }}>Tocá un ticket para ver o editar sus productos.</p>
            </div>
          </>
        )}
      </div>

      {/* Product comparison sheet: each café's average price, cheapest first */}
      {sel && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center animate-in fade-in duration-200" style={{ background: 'rgba(20,28,24,0.45)' }} onClick={() => setOpenProduct(null)}>
          <div
            className="w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl p-6 max-h-[78vh] overflow-y-auto animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200"
            style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-pop)', paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: '#E5EBE8' }} />
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xl">{groupMeta(sel.group).icon}</span>
              <h2 className="text-lg font-black flex-1" style={{ color: '#18211D' }}>{sel.name}</h2>
            </div>
            <p className="text-xs mb-4" style={{ color: '#5B6660' }}>
              {sel.merchants.length > 1
                ? `Precio promedio por café · ${sel.count} compra${sel.count !== 1 ? 's' : ''}`
                : `${sel.count} compra${sel.count !== 1 ? 's' : ''} en un solo café`}
            </p>
            <div className="flex flex-col">
              {sel.merchants.map((m, i) => {
                const isCheapest = sel.merchants.length > 1 && i === 0;
                const isDearest = sel.merchants.length > 1 && i === sel.merchants.length - 1;
                const color = isCheapest ? '#1F8A68' : isDearest ? '#E25749' : '#18211D';
                return (
                  <div key={m.merchant} className="flex items-center gap-3 py-2.5" style={{ borderTop: i > 0 ? '1px solid #EAF0ED' : 'none' }}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: '#18211D' }}>{m.merchant}</p>
                      <p className="text-[11px]" style={{ color: '#8C968F' }}>
                        {m.times} vez{m.times !== 1 ? 'es' : ''}
                        {isCheapest ? ' · más barato 🏆' : isDearest ? ' · el más caro' : ''}
                      </p>
                    </div>
                    <span className="text-sm font-black tabular-nums shrink-0" style={{ color }}>{format(Math.round(m.unit))}</span>
                  </div>
                );
              })}
            </div>
            {sel.merchants.length > 1 && (
              <div className="mt-4 rounded-2xl p-3" style={{ background: '#DDF0E8' }}>
                <p className="text-xs font-semibold" style={{ color: '#1F8A68' }}>
                  Ahorrás {format(Math.round(sel.max.unit - sel.min.unit))} tomando {sel.name.toLowerCase()} en {sel.min.merchant} en vez de {sel.max.merchant}.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      <ReceiptItemsSheet
        open={!!openTx}
        onClose={() => setOpenTx(null)}
        householdId={profile.household_id}
        transactionId={openTx?.id ?? null}
        merchant={openTx?.merchant ?? null}
        total={openTx?.amount ?? 0}
        tip={openTx ? (tipByTxId.get(openTx.id) ?? 0) : 0}
        currency={openTx?.currency ?? 'ARS'}
        occurredOn={openTx?.occurred_on ?? curMonth + '-01'}
      />

      <BottomNav onFab={() => {}} />
    </div>
  );
}
