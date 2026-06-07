'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { useFx } from '@/hooks/useFx';
import { BottomNav } from '@/components/BottomNav';
import { MoneyInput } from '@/components/MoneyInput';
import { PrimaryButton } from '@/components/PrimaryButton';
import { formatARS, formatUSD } from '@/lib/format';
import { triggerBudgetAlerts } from '@/lib/notifyBudgets';
import { toast } from 'sonner';
import Link from 'next/link';

interface Profile {
  id: string;
  household_id: string;
  nickname: string | null;
  display_name: string | null;
}

interface Item {
  name: string;
  qty: number;
  line_total: number;
  group: string;
}

interface Receipt {
  merchant: string;
  date: string;
  total: number;
  // Currency detected from the proof (ARS by default, USD for dollar charges).
  currency: 'ARS' | 'USD';
  suggested_category: string;
  items: Item[];
}

const GROUPS = ['frutas y verduras', 'carnes y fiambres', 'lácteos y huevos', 'almacén', 'panadería', 'bebidas', 'snacks', 'limpieza', 'cuidado personal', 'hogar', 'mascotas', 'otros'];
const GROUP_META: Record<string, { icon: string; color: string }> = {
  'frutas y verduras': { icon: '🥦', color: '#6FBF73' },
  'carnes y fiambres': { icon: '🥩', color: '#D9776A' },
  'lácteos y huevos': { icon: '🧀', color: '#F2C879' },
  'almacén': { icon: '🥫', color: '#C9A86A' },
  'panadería': { icon: '🍞', color: '#E0B080' },
  bebidas: { icon: '🥤', color: '#6FA8DC' },
  snacks: { icon: '🍫', color: '#F5A623' },
  limpieza: { icon: '🧼', color: '#5C9CE6' },
  'cuidado personal': { icon: '🧴', color: '#E89AC7' },
  hogar: { icon: '🏠', color: '#B084CC' },
  mascotas: { icon: '🐾', color: '#A0855B' },
  otros: { icon: '🏷️', color: '#C4B9AE' },
  // Legacy bucket from receipts scanned before the food split — kept so old
  // items still render with a label/icon instead of falling back to "otros".
  comida: { icon: '🍎', color: '#7EC8A4' },
};

export default function TicketClient({ profile }: { profile: Profile }) {
  const supabase = createClient();
  const qc = useQueryClient();
  const { arsPerUsd } = useFx();
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<'idle' | 'working' | 'review' | 'done'>('idle');
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [categoryId, setCategoryId] = useState<string>('');

  // Shared cache key with the rest of the app, so we fetch ALL categories
  // (filtering to 'expense' in the query here would poison that shared cache
  // and hide income categories elsewhere). We filter to expense in the UI.
  const { data: allCategories = [] } = useQuery({
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
  const categories = allCategories.filter((c) => c.kind === 'expense');

  // Map the AI's suggested category onto a real category: exact name first, then
  // a partial match (so "Transporte" still lands on "Transporte / Viajes"), and
  // only the first category as a last resort — no supermarket-specific fallback,
  // which used to mis-bucket non-grocery proofs (e.g. a DiDi ride).
  function defaultCategory(suggested: string): string {
    const lc = (suggested ?? '').toLowerCase().trim();
    if (lc) {
      const byName = categories.find((c) => c.name.toLowerCase() === lc);
      if (byName) return byName.id;
      const partial = categories.find(
        (c) => c.name.toLowerCase().includes(lc) || lc.includes(c.name.toLowerCase()),
      );
      if (partial) return partial.id;
    }
    return categories[0]?.id ?? '';
  }

  // Format a value in the receipt's own currency (a USD proof stays in dollars).
  function fmt(n: number): string {
    return receipt?.currency === 'USD' ? formatUSD(n) : formatARS(n);
  }

  // Accepts one OR several files: a long ticket photographed in pieces is
  // uploaded as multiple images, then sent together to the AI as a single
  // continuous receipt (it merges items + total instead of returning 3 receipts).
  async function handleFiles(files: File[]) {
    setStatus('working');
    try {
      const { data: { session } } = await supabase.auth.getSession();

      // Upload every photo, collecting their storage paths in order.
      const filePaths: string[] = [];
      for (const file of files) {
        const ext = file.name.split('.').pop() || 'jpg';
        const id = crypto.randomUUID();
        const filePath = `${profile.household_id}/${id}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('statements')
          .upload(filePath, file, { contentType: file.type, upsert: false });
        if (upErr) throw upErr;
        filePaths.push(filePath);
      }

      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/parse-receipt`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_paths: filePaths }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'No se pudo leer el ticket');

      const r = json.receipt as Receipt;
      // Guard the currency in case an older function version omits it.
      setReceipt({ ...r, currency: r.currency === 'USD' ? 'USD' : 'ARS' });
      setCategoryId(defaultCategory(r.suggested_category));
      setStatus('review');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al leer el ticket');
      setStatus('idle');
    }
  }

  function updateItem(i: number, patch: Partial<Item>) {
    if (!receipt) return;
    const items = receipt.items.map((it, idx) => (idx === i ? { ...it, ...patch } : it));
    setReceipt({ ...receipt, items });
  }
  function removeItem(i: number) {
    if (!receipt) return;
    setReceipt({ ...receipt, items: receipt.items.filter((_, idx) => idx !== i) });
  }

  async function handleSave() {
    if (!receipt) return;
    setStatus('working');
    try {
      const summary = receipt.items.map((it) => it.name).join(', ').slice(0, 500);
      const { data: tx, error: txErr } = await supabase
        .from('transactions')
        .insert({
          household_id: profile.household_id,
          profile_id: profile.id,
          type: 'expense',
          amount: receipt.total,
          currency: receipt.currency,
          usd_rate_snapshot: arsPerUsd,
          category_id: categoryId || null,
          merchant: receipt.merchant || 'Compra',
          occurred_on: receipt.date,
          description: summary || null,
          source: 'receipt',
        })
        .select('id')
        .single();
      if (txErr || !tx) throw txErr ?? new Error('No se pudo guardar');

      if (receipt.items.length > 0) {
        const { error: itErr } = await supabase.from('transaction_items').insert(
          receipt.items.map((it) => ({
            household_id: profile.household_id,
            transaction_id: tx.id,
            name: it.name,
            qty: it.qty,
            line_total: it.line_total,
            item_group: it.group,
          })),
        );
        if (itErr) throw itErr;
      }

      await qc.invalidateQueries({ queryKey: ['transactions'] });
      await qc.invalidateQueries({ queryKey: ['account-tx'] });
      await qc.invalidateQueries({ queryKey: ['spent-by-category'] });
      await qc.invalidateQueries({ queryKey: ['category-month-totals'] });
      await qc.invalidateQueries({ queryKey: ['category-tx'] });
      triggerBudgetAlerts(supabase);
      setStatus('done');
      toast.success('Comprobante guardado ✓');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar');
      setStatus('review');
    }
  }

  const groupTotals = receipt
    ? GROUPS.map((g) => ({ g, total: receipt.items.filter((it) => it.group === g).reduce((s, it) => s + it.line_total, 0) }))
        .filter((x) => x.total > 0)
        .sort((a, b) => b.total - a.total)
    : [];
  const itemsSum = receipt ? receipt.items.reduce((s, it) => s + it.line_total, 0) : 0;

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F9F5F0' }}>
      <header className="px-5 pt-14 pb-4 flex items-center gap-3">
        <Link href="/mas" className="text-2xl">←</Link>
        <h1 className="text-2xl font-black" style={{ color: '#2D2D2D' }}>Escanear comprobante 🧾</h1>
      </header>

      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/heic,image/webp,application/pdf"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []).slice(0, 8);
          if (files.length) handleFiles(files);
          e.target.value = '';
        }}
      />

      <div className="px-4 flex flex-col gap-4">
        {/* Idle / capture */}
        {status === 'idle' && (
          <div className="rounded-3xl p-6 text-center" style={{ background: '#FFFFFF' }}>
            <p className="text-5xl mb-3">🧾</p>
            <p className="font-bold mb-1" style={{ color: '#2D2D2D' }}>Subí un ticket o un comprobante</p>
            <p className="text-sm mb-5" style={{ color: '#6B6459' }}>
              Sirve para tickets de súper, facturas o capturas de notificaciones del banco/billetera
              (DiDi, Mercado Pago, etc.). La IA lo categoriza y detecta la moneda.
              ¿Ticket largo? Sacale varias fotos y subílas todas juntas: se leen como un único comprobante.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => { fileRef.current?.setAttribute('capture', 'environment'); fileRef.current?.click(); }}
                className="flex-1 py-3.5 rounded-2xl text-sm font-bold text-white"
                style={{ background: '#FF7F6B' }}
              >
                📷 Sacar foto
              </button>
              <button
                onClick={() => { fileRef.current?.removeAttribute('capture'); fileRef.current?.click(); }}
                className="flex-1 py-3.5 rounded-2xl text-sm font-bold"
                style={{ background: '#E4F2EA', color: '#5BA886' }}
              >
                🖼️ Subir imagen
              </button>
            </div>
          </div>
        )}

        {/* Working */}
        {status === 'working' && (
          <div className="rounded-3xl p-8 text-center" style={{ background: '#FFFFFF' }}>
            <p className="text-4xl mb-3 animate-pulse">🤖</p>
            <p className="font-bold" style={{ color: '#2D2D2D' }}>Leyendo el comprobante…</p>
            <p className="text-sm mt-1" style={{ color: '#6B6459' }}>Esto tarda unos segundos.</p>
          </div>
        )}

        {/* Review */}
        {status === 'review' && receipt && (
          <>
            <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
              <div className="flex gap-3 mb-3">
                <input
                  value={receipt.merchant}
                  onChange={(e) => setReceipt({ ...receipt, merchant: e.target.value })}
                  className="flex-1 px-3 py-2 rounded-xl border text-sm font-bold outline-none"
                  style={{ borderColor: '#ECE5DC', color: '#2D2D2D' }}
                  placeholder="Comercio"
                />
                <input
                  type="date"
                  value={receipt.date}
                  onChange={(e) => setReceipt({ ...receipt, date: e.target.value })}
                  className="px-3 py-2 rounded-xl border text-sm outline-none"
                  style={{ borderColor: '#ECE5DC', color: '#2D2D2D' }}
                />
              </div>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-xs font-semibold" style={{ color: '#6B6459' }}>Total</span>
                {/* Currency toggle — the AI detects it, but you can correct it. */}
                <button
                  onClick={() => setReceipt({ ...receipt, currency: receipt.currency === 'USD' ? 'ARS' : 'USD' })}
                  className="text-xs font-bold px-3 py-1.5 rounded-xl border"
                  style={{
                    borderColor: receipt.currency === 'USD' ? '#FF7F6B' : '#7EC8A4',
                    color: receipt.currency === 'USD' ? '#FF7F6B' : '#7EC8A4',
                  }}
                >
                  {receipt.currency}
                </button>
                <MoneyInput
                  value={receipt.total}
                  onChange={(n) => setReceipt({ ...receipt, total: n })}
                  className="flex-1 px-3 py-2 rounded-xl border text-base font-black outline-none"
                  style={{ borderColor: '#ECE5DC', color: '#FF7F6B' }}
                />
              </div>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border text-sm bg-white outline-none"
                style={{ borderColor: '#ECE5DC', color: '#2D2D2D' }}
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                ))}
              </select>
              {receipt.items.length > 0 && Math.abs(itemsSum - receipt.total) > Math.max(50, receipt.total * 0.05) && (
                <p className="text-[11px] mt-2" style={{ color: '#B8860B' }}>
                  ⚠️ La suma de productos ({fmt(itemsSum)}) no coincide con el total. Revisá los ítems.
                </p>
              )}
            </div>

            {/* Group breakdown */}
            {groupTotals.length > 0 && (
              <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
                <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: '#6B6459' }}>En qué se fue</p>
                <div className="flex flex-col gap-2">
                  {groupTotals.map(({ g, total }) => {
                    const meta = GROUP_META[g] ?? GROUP_META.otros;
                    return (
                      <div key={g} className="flex items-center gap-2">
                        <span>{meta.icon}</span>
                        <span className="text-sm capitalize flex-1" style={{ color: '#2D2D2D' }}>{g}</span>
                        <span className="text-xs font-semibold" style={{ color: '#6B6459' }}>{Math.round((total / itemsSum) * 100)}%</span>
                        <span className="text-sm font-bold w-24 text-right" style={{ color: meta.color }}>{fmt(total)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Items — only for itemized receipts; a single-charge proof
                (e.g. a DiDi notification) has none, so we skip the list. */}
            {receipt.items.length > 0 && (
            <div className="rounded-3xl p-3" style={{ background: '#FFFFFF' }}>
              <p className="text-xs font-bold uppercase tracking-wide mb-2 px-2" style={{ color: '#6B6459' }}>
                Productos ({receipt.items.length})
              </p>
              <div className="flex flex-col">
                {receipt.items.map((it, i) => (
                  <div key={i} className="flex items-center gap-2 px-2 py-2" style={{ borderTop: i > 0 ? '1px solid #ECE5DC' : 'none' }}>
                    <input
                      value={it.name}
                      onChange={(e) => updateItem(i, { name: e.target.value })}
                      className="flex-1 min-w-0 text-sm outline-none bg-transparent"
                      style={{ color: '#2D2D2D' }}
                    />
                    <select
                      value={it.group}
                      onChange={(e) => updateItem(i, { group: e.target.value })}
                      className="text-[11px] rounded-lg px-1.5 py-1 border bg-white outline-none"
                      style={{ borderColor: '#ECE5DC', color: '#6B6459' }}
                    >
                      {GROUPS.map((g) => <option key={g} value={g}>{GROUP_META[g]?.icon} {g}</option>)}
                    </select>
                    <MoneyInput
                      value={it.line_total}
                      onChange={(n) => updateItem(i, { line_total: n })}
                      className="w-20 text-sm font-bold text-right outline-none bg-transparent"
                      style={{ color: '#2D2D2D' }}
                    />
                    <button onClick={() => removeItem(i)} className="text-xs px-1" style={{ color: '#FF7F6B' }}>✕</button>
                  </div>
                ))}
              </div>
            </div>
            )}

            <PrimaryButton
              onClick={handleSave}
              disabled={receipt.total <= 0}
              className="w-full py-4 text-sm"
            >
              Guardar gasto de {fmt(receipt.total)}
            </PrimaryButton>
            <button
              onClick={() => { setReceipt(null); setStatus('idle'); }}
              className="w-full py-3 rounded-2xl text-sm font-bold"
              style={{ color: '#6B6459' }}
            >
              Descartar
            </button>
          </>
        )}

        {/* Done */}
        {status === 'done' && (
          <div className="rounded-3xl p-6 text-center" style={{ background: '#FFFFFF' }}>
            <p className="text-5xl mb-3">✅</p>
            <p className="font-bold mb-1" style={{ color: '#2D2D2D' }}>¡Comprobante guardado!</p>
            <p className="text-sm mb-5" style={{ color: '#6B6459' }}>Quedó cargado en tus movimientos.</p>
            <div className="flex gap-3">
              <button
                onClick={() => { setReceipt(null); setStatus('idle'); }}
                className="flex-1 py-3.5 rounded-2xl text-sm font-bold"
                style={{ background: '#E4F2EA', color: '#5BA886' }}
              >
                Escanear otro
              </button>
              <Link
                href="/movimientos"
                className="flex-1 py-3.5 rounded-2xl text-sm font-bold text-white flex items-center justify-center"
                style={{ background: '#7EC8A4' }}
              >
                Ver movimientos
              </Link>
            </div>
          </div>
        )}
      </div>

      <BottomNav onFab={() => {}} />
    </div>
  );
}
