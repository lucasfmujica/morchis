'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { useFx } from '@/hooks/useFx';
import { formatARS } from '@/lib/format';
import { toArs } from '@/lib/budgets';
import { toLocalISO, shortDayMonth } from '@/lib/date';
import { assetBalance, type AccountRow, type AccountTx } from '@/lib/accounts';
import { expandOccurrences, type RecurrenceLike } from '@/lib/recurrence';

// Forward-looking cash-flow projection (household-level). Starts from today's
// on-budget cash and walks forward, overlaying:
//   - future-dated transactions already in the DB (mainly cuotas), which
//     assetBalance() picks up for free since accountTx isn't date-capped, and
//   - future occurrences of active recurring rules (not yet materialized).
// Only FUTURE rule occurrences are added, so there's no double count with the
// rows the cron already posted.

interface RuleRow extends RecurrenceLike {
  id: string;
  direction: 'income' | 'expense';
  amount: number;
  currency: 'ARS' | 'USD';
}

const HORIZONS = [30, 60, 90] as const;

export function CashFlowForecast({
  householdId,
  accounts,
  accountTx,
}: {
  householdId: string;
  accounts: (AccountRow & { on_budget: boolean })[];
  accountTx: AccountTx[];
}) {
  const supabase = createClient();
  const { arsPerUsd } = useFx();
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]>(60);

  const { data: rules = [] } = useQuery({
    queryKey: ['cashflow-rules', householdId],
    enabled: !!householdId,
    queryFn: async () => {
      const { data } = await supabase
        .from('recurring_rules')
        .select('id, direction, amount, currency, cadence, anchor_day, next_run, is_variable')
        .eq('household_id', householdId)
        .eq('active', true)
        // Variable rules are reminders, not committed cash — skip them.
        .eq('is_variable', false);
      return (data ?? []) as RuleRow[];
    },
  });

  const onBudget = useMemo(
    () => accounts.filter((a) => !a.archived && a.type !== 'credit' && a.on_budget),
    [accounts],
  );

  const series = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = toLocalISO(today);
    const endISO = toLocalISO(new Date(today.getTime() + horizon * 86400000));

    // Starting cash = on-budget asset balances as of today (ARS).
    const startCash = onBudget.reduce(
      (s, a) => s + toArs(assetBalance(accountTx, a.id, a.initial_balance ?? 0, todayISO), a.currency, arsPerUsd),
      0,
    );

    // Per-day deltas from future-dated transactions on on-budget accounts.
    const onBudgetIds = new Set(onBudget.map((a) => a.id));
    const curById = new Map(onBudget.map((a) => [a.id, a.currency] as const));
    const deltas = new Map<string, number>();
    const add = (iso: string, v: number) => deltas.set(iso, (deltas.get(iso) ?? 0) + v);
    for (const t of accountTx) {
      if (t.occurred_on <= todayISO || t.occurred_on > endISO) continue;
      if (t.account_id && onBudgetIds.has(t.account_id)) {
        const cur = curById.get(t.account_id);
        if (t.type === 'income') add(t.occurred_on, toArs(t.amount, cur, arsPerUsd));
        else if (t.type === 'expense' || t.type === 'transfer') add(t.occurred_on, -toArs(t.amount, cur, arsPerUsd));
      }
      if (t.type === 'transfer' && t.transfer_account_id && onBudgetIds.has(t.transfer_account_id)) {
        add(t.occurred_on, toArs(t.amount, curById.get(t.transfer_account_id), arsPerUsd));
      }
    }

    // Per-day deltas from future recurring-rule occurrences.
    for (const r of rules) {
      const delta = r.direction === 'income' ? toArs(r.amount, r.currency, arsPerUsd) : -toArs(r.amount, r.currency, arsPerUsd);
      for (const d of expandOccurrences(r, todayISO, endISO)) add(d, delta);
    }

    // Walk forward day by day, accumulating deltas.
    const pts: { day: number; iso: string; balance: number }[] = [];
    let bal = startCash;
    for (let i = 0; i <= horizon; i++) {
      const iso = toLocalISO(new Date(today.getTime() + i * 86400000));
      bal += deltas.get(iso) ?? 0;
      pts.push({ day: i, iso, balance: Math.round(bal) });
    }

    const end = pts[pts.length - 1].balance;
    let min = pts[0];
    for (const p of pts) if (p.balance < min.balance) min = p;
    return { pts, start: Math.round(startCash), end, min };
  }, [onBudget, accountTx, rules, horizon, arsPerUsd]);

  if (onBudget.length === 0) return null;

  const { pts, end, min } = series;
  const values = pts.map((p) => p.balance);
  const hi = Math.max(...values, 0);
  const lo = Math.min(...values, 0);
  const span = Math.max(1, hi - lo);
  // SVG viewBox 0..100 x 0..40 (top=2, bottom=38), 0-line and area fill.
  const X = (i: number) => (i / horizon) * 100;
  const Y = (v: number) => 38 - ((v - lo) / span) * 36;
  const linePts = pts.map((p) => `${X(p.day).toFixed(2)},${Y(p.balance).toFixed(2)}`).join(' ');
  const areaPath =
    `M ${pts.map((p) => `${X(p.day).toFixed(2)} ${Y(p.balance).toFixed(2)}`).join(' L ')}` +
    ` L 100 ${Y(lo).toFixed(2)} L 0 ${Y(lo).toFixed(2)} Z`;
  const dipsNegative = min.balance < 0;
  const stroke = dipsNegative ? '#E25749' : '#2FA37C';

  return (
    <div className="rounded-3xl p-5" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
      <div className="flex items-center justify-between mb-3 gap-2">
        <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#5B6660' }}>🔮 Flujo de caja proyectado</p>
        <div className="flex rounded-full overflow-hidden p-0.5 gap-0.5 shrink-0" style={{ background: '#E5EBE8' }}>
          {HORIZONS.map((h) => (
            <button
              key={h}
              onClick={() => setHorizon(h)}
              className="px-2.5 py-1 text-[11px] font-black rounded-full transition-all"
              style={{
                background: horizon === h ? '#FFFFFF' : 'transparent',
                color: horizon === h ? '#18211D' : '#5B6660',
                boxShadow: horizon === h ? 'var(--shadow-soft)' : 'none',
              }}
            >
              {h}d
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-3 mb-3">
        <div className="flex-1 rounded-2xl px-3 py-2.5" style={{ background: '#F1F5F3' }}>
          <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#5B6660' }}>En {horizon} días</p>
          <p className="text-lg font-black leading-tight tabular-nums" style={{ color: end < 0 ? '#E25749' : '#1F8A68' }}>
            {formatARS(end)}
          </p>
        </div>
        <div className="flex-1 rounded-2xl px-3 py-2.5" style={{ background: dipsNegative ? '#FFE5E0' : '#F1F5F3' }}>
          <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#5B6660' }}>Saldo mínimo</p>
          <p className="text-lg font-black leading-tight tabular-nums" style={{ color: dipsNegative ? '#E25749' : '#18211D' }}>
            {formatARS(min.balance)}
          </p>
          <p className="text-[10px]" style={{ color: '#8C968F' }}>{min.day === 0 ? 'hoy' : shortDayMonth(min.iso)}</p>
        </div>
      </div>

      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="w-full" style={{ height: 96 }}>
        {/* zero baseline */}
        <line x1="0" y1={Y(0).toFixed(2)} x2="100" y2={Y(0).toFixed(2)} stroke="#CFD8D3" strokeWidth="0.4" strokeDasharray="1.5 1.5" />
        <path d={areaPath} fill={stroke} fillOpacity="0.12" />
        <polyline points={linePts} fill="none" stroke={stroke} strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {dipsNegative && <circle cx={X(min.day).toFixed(2)} cy={Y(min.balance).toFixed(2)} r="1.4" fill="#E25749" />}
      </svg>

      <p className="text-[10px] mt-2 leading-snug" style={{ color: '#8C968F' }}>
        Estimación a nivel hogar: parte del efectivo on-budget de hoy e incluye cuotas futuras y reglas recurrentes fijas. No incluye gastos variables.
      </p>
    </div>
  );
}
