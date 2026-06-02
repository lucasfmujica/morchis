'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { BottomNav } from '@/components/BottomNav';
import { MoneyInput } from '@/components/MoneyInput';
import { PrimaryButton } from '@/components/PrimaryButton';
import { formatARS } from '@/lib/format';
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
  suggested_category: string;
  items: Item[];
}

const GROUPS = ['comida', 'bebidas', 'snacks', 'limpieza', 'cuidado personal', 'hogar', 'mascotas', 'otros'];
const GROUP_META: Record<string, { icon: string; color: string }> = {
  comida: { icon: '🍎', color: '#7EC8A4' },
  bebidas: { icon: '🥤', color: '#6FA8DC' },
  snacks: { icon: '🍫', color: '#F5A623' },
  limpieza: { icon: '🧼', color: '#5C9CE6' },
  'cuidado personal': { icon: '🧴', color: '#E89AC7' },
  hogar: { icon: '🏠', color: '#B084CC' },
  mascotas: { icon: '🐾', color: '#A0855B' },
  otros: { icon: '🏷️', color: '#C4B9AE' },
};

export default function TicketClient({ profile }: { profile: Profile }) {
  const supabase = createClient();
  const qc = useQueryClient();
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

  function defaultCategory(suggested: string): string {
    const lc = suggested.toLowerCase();
    const byName = categories.find((c) => c.name.toLowerCase() === lc);
    if (byName) return byName.id;
    const supe = categories.find((c) => /super|almac/i.test(c.name));
    return supe?.id ?? categories[0]?.id ?? '';
  }

  async function handleFile(file: File) {
    setStatus('working');
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const id = crypto.randomUUID();
      const filePath = `${profile.household_id}/${id}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from('statements')
        .upload(filePath, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;

      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/parse-receipt`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_path: filePath }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'No se pudo leer el ticket');

      const r = json.receipt as Receipt;
      setReceipt(r);
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
      triggerBudgetAlerts(supabase);
      setStatus('done');
      toast.success('Ticket guardado ✓');
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
        <h1 className="text-2xl font-black" style={{ color: '#2D2D2D' }}>Escanear ticket 🧾</h1>
      </header>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/heic,image/webp,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = '';
        }}
      />

      <div className="px-4 flex flex-col gap-4">
        {/* Idle / capture */}
        {status === 'idle' && (
          <div className="rounded-3xl p-6 text-center" style={{ background: '#FFFFFF' }}>
            <p className="text-5xl mb-3">🧾</p>
            <p className="font-bold mb-1" style={{ color: '#2D2D2D' }}>Sacale una foto al ticket</p>
            <p className="text-sm mb-5" style={{ color: '#6B6459' }}>
              La IA detecta los productos y te dice en qué se fue la plata (comida, limpieza, snacks…).
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
            <p className="font-bold" style={{ color: '#2D2D2D' }}>Leyendo el ticket…</p>
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
              {Math.abs(itemsSum - receipt.total) > Math.max(50, receipt.total * 0.05) && (
                <p className="text-[11px] mt-2" style={{ color: '#B8860B' }}>
                  ⚠️ La suma de productos ({formatARS(itemsSum)}) no coincide con el total. Revisá los ítems.
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
                        <span className="text-sm font-bold w-24 text-right" style={{ color: meta.color }}>{formatARS(total)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Items */}
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

            <PrimaryButton
              onClick={handleSave}
              disabled={receipt.total <= 0}
              className="w-full py-4 text-sm"
            >
              Guardar gasto de {formatARS(receipt.total)}
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
            <p className="font-bold mb-1" style={{ color: '#2D2D2D' }}>¡Ticket guardado!</p>
            <p className="text-sm mb-5" style={{ color: '#6B6459' }}>Quedó cargado con el detalle de productos.</p>
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
