'use client';

import { useState, useRef, useEffect } from 'react';
import { createClient } from '@/lib/supabase';
import { BottomNav } from '@/components/BottomNav';
import { AddTransactionSheet } from '@/components/AddTransactionSheet';
import { useQuery } from '@tanstack/react-query';
import { formatARS, formatUSD, arsToUsd } from '@/lib/format';
import { useFx } from '@/hooks/useFx';
import Link from 'next/link';

interface Profile {
  id: string;
  household_id: string;
  nickname: string | null;
  display_name: string | null;
}

interface SimResult {
  parsed: { item: string; amount_ars: number; currency_input: 'ARS' | 'USD'; installments: number | null };
  projection: { current: number; new: number };
  monthly_cost: number;
  savings_rate: { current: number; new: number };
  goal_delays: { name: string; icon: string; slip_months: number; is_past_deadline: boolean }[];
  budget_overflows: { category: string; budget: number; current_spend: number; after_purchase: number }[];
  fx_rate: number;
  is_negative_impact: boolean;
}

const CORAL = '#FF7F6B';
const SAGE = '#7ABF8E';
const SURFACE = '#FFFFFF';
const CREAM = '#F9F5F0';
const CHARCOAL = '#2D2D2D';
const MUTED = '#6B6459';
const BORDER = '#ECE5DC';

const SUGGESTIONS = [
  'Quiero comprar un teléfono de $1.500.000 en 12 cuotas',
  'Notebook US$800 en 6 cuotas',
  'Viaje $500.000',
  'Smart TV $350.000 en 3 cuotas',
];

export default function SimuladorClient({ profile }: { profile: Profile }) {
  const supabase = createClient();
  const { format, secondary, arsPerUsd } = useFx();
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SimResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fabType, setFabType] = useState<'expense' | 'income'>('expense');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase.from('categories').select('id, name, icon, kind, color').eq('household_id', profile.household_id).order('name');
      return data ?? [];
    },
  });
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase.from('accounts').select('id, name, type, owner_profile_id').eq('household_id', profile.household_id).eq('archived', false).order('name');
      return data ?? [];
    },
  });

  async function simulate() {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/simulate-purchase`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text }),
        },
      );
      if (!resp.ok) throw new Error('Error en el servidor');
      const data: SimResult = await resp.json();
      setResult(data);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch (e) {
      setError('No se pudo simular. Intentá de nuevo.');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  function pct(r: number) {
    if (!Number.isFinite(r)) return '—';
    return `${r >= 0 ? '+' : ''}${Math.round(r * 100)}%`;
  }

  const name = profile.nickname ?? profile.display_name ?? 'Morch';

  return (
    <div className="min-h-screen pb-28" style={{ background: CREAM }}>
      {/* Header */}
      <header className="px-5 pt-14 pb-4 flex items-center gap-3">
        <Link href="/mas" className="text-2xl leading-none" style={{ color: MUTED }}>←</Link>
        <h1 className="text-2xl font-black" style={{ color: CHARCOAL }}>Simulador</h1>
      </header>

      <div className="px-4 flex flex-col gap-4">
        {/* Input card */}
        <div className="rounded-3xl p-5" style={{ background: SURFACE }}>
          <p className="text-sm font-semibold mb-3" style={{ color: MUTED }}>
            ¿Qué querés comprar, {name}?
          </p>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); simulate(); } }}
            placeholder="Quiero comprar un teléfono de $1.500.000 en 12 cuotas"
            rows={3}
            className="w-full resize-none rounded-2xl px-4 py-3 text-base outline-none border"
            style={{
              borderColor: BORDER,
              color: CHARCOAL,
              background: CREAM,
              fontFamily: 'inherit',
            }}
          />

          {/* Suggestions */}
          {!text && (
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => setText(s)}
                  className="px-3 py-1.5 rounded-full text-xs font-medium border"
                  style={{ borderColor: BORDER, color: MUTED, background: CREAM }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={simulate}
            disabled={loading || !text.trim()}
            className="mt-4 w-full py-4 rounded-2xl text-base font-bold transition-opacity"
            style={{
              background: CORAL,
              color: '#fff',
              opacity: loading || !text.trim() ? 0.6 : 1,
            }}
          >
            {loading ? 'Simulando…' : 'Simular'}
          </button>
        </div>

        {error && (
          <p className="text-center text-sm" style={{ color: CORAL }}>{error}</p>
        )}

        {/* Result card */}
        {result && (
          <div ref={resultRef} className="rounded-3xl overflow-hidden" style={{ background: SURFACE }}>
            {/* Purchase summary */}
            <div className="px-5 pt-5 pb-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: MUTED }}>Compra analizada</p>
              <p className="text-lg font-black" style={{ color: CHARCOAL }}>
                {result.parsed.item}
              </p>
              <p className="text-2xl font-black mt-1" style={{ color: result.is_negative_impact ? CORAL : CHARCOAL }}>
                {format(result.parsed.amount_ars)}
              </p>
              {result.parsed.installments && (
                <p className="text-sm mt-0.5" style={{ color: MUTED }}>
                  {result.parsed.installments} cuotas de{' '}
                  <span className="font-semibold" style={{ color: CHARCOAL }}>{format(result.monthly_cost)}</span>
                  /mes
                </p>
              )}
              {result.parsed.currency_input === 'USD' && (
                <p className="text-xs mt-0.5" style={{ color: MUTED }}>
                  Convertido a {formatARS(result.parsed.amount_ars)} al dólar blue ({formatARS(Math.round(result.fx_rate))})
                </p>
              )}
            </div>

            {/* Month-end projection */}
            <div className="px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: MUTED }}>
                Proyección fin de mes
              </p>
              <div className="flex gap-4">
                <div className="flex-1">
                  <p className="text-xs" style={{ color: MUTED }}>Sin la compra</p>
                  <p className="text-xl font-black" style={{ color: result.projection.current >= 0 ? SAGE : CORAL }}>
                    {format(result.projection.current)}
                  </p>
                  <p className="text-xs" style={{ color: MUTED }}>{secondary(result.projection.current)}</p>
                </div>
                <div className="text-2xl self-center" style={{ color: MUTED }}>→</div>
                <div className="flex-1">
                  <p className="text-xs" style={{ color: MUTED }}>Con la compra</p>
                  <p className="text-xl font-black" style={{ color: result.projection.new >= 0 ? SAGE : CORAL }}>
                    {format(result.projection.new)}
                  </p>
                  <p className="text-xs" style={{ color: MUTED }}>{secondary(result.projection.new)}</p>
                </div>
              </div>
            </div>

            {/* Savings rate */}
            <div className="px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: MUTED }}>
                Tasa de ahorro
              </p>
              <div className="flex items-center gap-3">
                <span className="text-xl font-black" style={{ color: SAGE }}>
                  {pct(result.savings_rate.current)}
                </span>
                <span style={{ color: MUTED }}>→</span>
                <span
                  className="text-xl font-black"
                  style={{ color: result.savings_rate.new < result.savings_rate.current ? CORAL : SAGE }}
                >
                  {pct(result.savings_rate.new)}
                </span>
                <span className="text-sm ml-1" style={{ color: result.savings_rate.new < result.savings_rate.current ? CORAL : SAGE }}>
                  ({pct(result.savings_rate.new - result.savings_rate.current)})
                </span>
              </div>
            </div>

            {/* Goal delays */}
            {result.goal_delays.length > 0 && (
              <div className="px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: MUTED }}>
                  Impacto en tus metas
                </p>
                <div className="flex flex-col gap-2">
                  {result.goal_delays.map((g, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <span className="text-base" style={{ color: CHARCOAL }}>
                        {g.icon} {g.name}
                      </span>
                      {g.slip_months === 0 ? (
                        <span className="text-sm font-semibold" style={{ color: SAGE }}>Sin impacto</span>
                      ) : (
                        <span className="text-sm font-semibold px-2 py-0.5 rounded-full" style={{ background: '#FFF0ED', color: CORAL }}>
                          ~{g.slip_months} mes{g.slip_months !== 1 ? 'es' : ''} de retraso
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Budget overflows */}
            {result.budget_overflows.length > 0 && (
              <div className="px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: MUTED }}>
                  Presupuesto excedido
                </p>
                {result.budget_overflows.map((b, i) => (
                  <div key={i}>
                    <div className="flex justify-between text-sm mb-1">
                      <span style={{ color: CHARCOAL }}>{b.category}</span>
                      <span style={{ color: CORAL }}>{format(b.after_purchase)} / {format(b.budget)}</span>
                    </div>
                    <div className="rounded-full overflow-hidden h-2" style={{ background: BORDER }}>
                      <div
                        className="h-2 rounded-full"
                        style={{ width: `${b.budget > 0 ? Math.min(100, (b.after_purchase / b.budget) * 100) : 100}%`, background: CORAL }}
                      />
                    </div>
                    <p className="text-xs mt-1" style={{ color: CORAL }}>
                      Te pasás {format(b.after_purchase - b.budget)} del presupuesto
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Summary verdict */}
            <div
              className="px-5 py-4"
              style={{ background: result.is_negative_impact ? '#FFF0ED' : '#F0FAF3' }}
            >
              <p className="text-sm font-bold" style={{ color: result.is_negative_impact ? CORAL : SAGE }}>
                {result.is_negative_impact
                  ? result.projection.new < 0
                    ? `Si comprás esto, terminás el mes en rojo (${format(result.projection.new)}).`
                    : `Esta compra impacta tu ahorro este mes.`
                  : `Esta compra entra dentro de tu capacidad de ahorro del mes.`}
              </p>
              {result.goal_delays.some(g => g.slip_months > 0) && (
                <p className="text-xs mt-1" style={{ color: result.is_negative_impact ? CORAL : MUTED }}>
                  {result.goal_delays
                    .filter(g => g.slip_months > 0)
                    .map(g => `La meta "${g.name}" se atrasa ~${g.slip_months} mes${g.slip_months !== 1 ? 'es' : ''}.`)
                    .join(' ')}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <BottomNav onFab={(type) => { setFabType(type); setSheetOpen(true); }} />
      <AddTransactionSheet
        open={sheetOpen}
        initialType={fabType}
        onClose={() => setSheetOpen(false)}
        householdId={profile.household_id}
        profileId={profile.id}
        categories={categories}
        accounts={accounts}
      />
    </div>
  );
}
