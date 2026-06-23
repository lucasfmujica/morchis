'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { createClient } from '@/lib/supabase';
import { useFx } from '@/hooks/useFx';
import { formatARS, formatUSD } from '@/lib/format';
import { toArs } from '@/lib/budgets';
import { shortDayMonth } from '@/lib/date';
import { daysUntil, whenLabel } from '@/lib/recurrence';

// Read-only "Próximos vencimientos" strip for the movements register — a lighter
// sibling of reglas' UpcomingBills (no edit/funding logic). Shows active
// recurring rules due within the next HORIZON_DAYS; tapping a row jumps to /reglas.

interface UpcomingRule {
  id: string;
  direction: 'income' | 'expense';
  label: string;
  amount: number;
  currency: 'ARS' | 'USD';
  next_run: string | null;
  is_variable: boolean;
  scope: 'personal' | 'household';
  profile_id: string;
}

const HORIZON_DAYS = 14;

function fmtMoney(amount: number, currency: string): string {
  return currency === 'USD' ? formatUSD(amount) : formatARS(amount);
}

export function UpcomingStrip({ householdId, profileId }: { householdId: string; profileId: string }) {
  const supabase = createClient();
  const { arsPerUsd } = useFx();
  const [open, setOpen] = useState(false);

  const { data: rules = [] } = useQuery({
    queryKey: ['upcoming-rules', householdId, profileId],
    enabled: !!householdId,
    queryFn: async () => {
      const { data } = await supabase
        .from('recurring_rules')
        .select('id, direction, label, amount, currency, next_run, is_variable, scope, profile_id')
        .eq('household_id', householdId)
        .eq('active', true);
      // Cada uno ve sus reglas personales + las del hogar; las personales del otro quedan ocultas.
      return ((data ?? []) as UpcomingRule[]).filter((r) => r.scope === 'household' || r.profile_id === profileId);
    },
  });

  const upcoming = rules
    .filter((r) => r.next_run != null && daysUntil(r.next_run) >= 0 && daysUntil(r.next_run) <= HORIZON_DAYS)
    .sort((a, b) => (a.next_run! < b.next_run! ? -1 : 1));

  if (upcoming.length === 0) return null;

  const totalExpense = upcoming
    .filter((r) => r.direction === 'expense')
    .reduce((s, r) => s + toArs(r.amount, r.currency, arsPerUsd), 0);

  return (
    <div className="mx-4 mb-3 rounded-2xl overflow-hidden" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left active:bg-[#F4F8F6] transition-colors"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-base">📅</span>
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#5B6660' }}>Próximos vencimientos</p>
            <p className="text-[11px]" style={{ color: '#8C968F' }}>
              {upcoming.length} en {HORIZON_DAYS} días{totalExpense > 0 ? ` · ${formatARS(totalExpense)}` : ''}
            </p>
          </div>
        </div>
        <span
          className="text-xs shrink-0"
          style={{ color: '#B0BAB4', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s ease' }}
        >
          ▸
        </span>
      </button>
      {open && (
        <div className="px-4 pb-3 flex flex-col gap-2">
          {upcoming.map((r) => {
            const d = daysUntil(r.next_run!);
            const soon = d <= 3;
            return (
              <Link
                key={r.id}
                href="/reglas"
                className="flex items-center gap-3 -mx-1 px-1 py-1 rounded-xl hover:bg-[#F4F8F6] active:bg-[#EEF3F1] transition-colors"
              >
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0"
                  style={{ background: r.direction === 'income' ? '#DDF0E8' : soon ? '#FFE5E0' : '#EAF0ED' }}
                >
                  {r.direction === 'income' ? '💰' : '📤'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-bold truncate" style={{ color: '#18211D' }}>{r.label}</p>
                    {r.is_variable && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0" style={{ background: '#FBF1D8', color: '#B8860B' }}>
                        recordatorio
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-semibold" style={{ color: soon ? '#E25749' : '#5B6660' }}>
                    {whenLabel(d)} · {shortDayMonth(r.next_run!)}
                  </p>
                </div>
                <p className="text-sm font-black shrink-0" style={{ color: r.direction === 'income' ? '#2FA37C' : '#FF6F61' }}>
                  {r.direction === 'income' ? '+' : '-'}{fmtMoney(r.amount, r.currency)}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
