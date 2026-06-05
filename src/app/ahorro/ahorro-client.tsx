'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { useFx } from '@/hooks/useFx';
import { BottomNav } from '@/components/BottomNav';
import { AddTransactionSheet } from '@/components/AddTransactionSheet';
import { DonutChart } from '@/components/DonutChart';
import { MonthlyBars, lastSixMonths } from '@/components/MonthlyBars';
import { formatARS } from '@/lib/format';
import { toast } from 'sonner';
import Link from 'next/link';

interface Profile {
  id: string;
  household_id: string;
  nickname: string | null;
  display_name: string | null;
}

interface MonthRow {
  key: string;
  label: string;
  income: number;
  expense: number;
  saved: number;
  rate: number | null;
}

export default function AhorroClient({
  profile,
  partnerProfileId,
  partnerName,
}: {
  profile: Profile;
  partnerProfileId?: string;
  partnerName?: string;
}) {
  const supabase = createClient();
  const qc = useQueryClient();
  const { arsPerUsd } = useFx();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fabType, setFabType] = useState<'expense' | 'income'>('expense');
  const [pendingPct, setPendingPct] = useState<number | null>(null);
  // scope: 'me' (Mío) | 'all' (Nuestro) | 'partner' — default to "Mío"
  const [scope, setScope] = useState<'me' | 'all' | 'partner'>('me');

  const today = new Date();
  const months = lastSixMonths(today);
  const currentKey = months[months.length - 1].key;
  const rangeStart = `${months[0].key}-01`;

  const { data: txns = [] } = useQuery({
    queryKey: ['transactions', profile.household_id, '6mo'],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('amount, type, occurred_on, profile_id, currency')
        .eq('household_id', profile.household_id)
        .gte('occurred_on', rangeStart);
      return data ?? [];
    },
  });

  const scopeProfileId =
    scope === 'me' ? profile.id : scope === 'partner' ? partnerProfileId : undefined;
  const toArs = (amount: number, currency?: string | null) =>
    currency === 'USD' && arsPerUsd > 0 ? Math.round(amount * arsPerUsd) : amount;

  const scopeTabs = [
    { key: 'me' as const, label: 'Mío' },
    { key: 'all' as const, label: 'Nuestro' },
    ...(partnerProfileId ? [{ key: 'partner' as const, label: partnerName || 'Pareja' }] : []),
  ];

  const { data: goalRows = [] } = useQuery({
    queryKey: ['savings_goals', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('savings_goals')
        .select('month, target_pct')
        .eq('household_id', profile.household_id);
      return data ?? [];
    },
  });

  const goalMap = new Map(goalRows.map((g) => [g.month, g.target_pct]));

  // Respect the Mío/Nuestro/pareja scope and normalize USD→ARS so the savings
  // rate is computed on a single currency.
  const scopedTxns = scopeProfileId ? txns.filter((t) => t.profile_id === scopeProfileId) : txns;

  const rows: MonthRow[] = months.map((m) => {
    let income = 0;
    let expense = 0;
    for (const t of scopedTxns) {
      if (!t.occurred_on.startsWith(m.key)) continue;
      const amt = toArs(t.amount, t.currency);
      if (t.type === 'income') income += amt;
      else if (t.type === 'expense') expense += amt;
    }
    const saved = income - expense;
    return { ...m, income, expense, saved, rate: income > 0 ? saved / income : null };
  });

  const current = rows[rows.length - 1];
  const savedTarget = goalMap.get(currentKey) ?? 20;
  const targetPct = pendingPct ?? savedTarget;
  const targetAmount = Math.round((current.income * targetPct) / 100);
  const targetReached = current.income > 0 && current.saved >= targetAmount;
  const progressPct = targetAmount > 0 ? Math.max(0, Math.min(1, current.saved / targetAmount)) : current.saved > 0 ? 1 : 0;

  const saveMutation = useMutation({
    mutationFn: async (pct: number) => {
      const { error } = await supabase
        .from('savings_goals')
        .upsert(
          { household_id: profile.household_id, month: currentKey, target_pct: pct, updated_at: new Date().toISOString() },
          { onConflict: 'household_id,month' },
        );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['savings_goals', profile.household_id] }),
    onError: () => toast.error('No se pudo guardar la meta.'),
  });

  function changeTarget(delta: number) {
    const next = Math.max(0, Math.min(100, targetPct + delta));
    setPendingPct(next);
    saveMutation.mutate(next);
  }

  const sixMoSaved = rows.reduce((s, r) => s + r.saved, 0);
  const sixMoIncome = rows.reduce((s, r) => s + r.income, 0);
  const avgRate = sixMoIncome > 0 ? sixMoSaved / sixMoIncome : null;

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F9F5F0' }}>
      <header className="px-5 pt-14 pb-4 flex items-center gap-3">
        <Link href="/mas" className="text-2xl">←</Link>
        <h1 className="text-2xl font-black" style={{ color: '#2D2D2D' }}>Ahorro 🐷</h1>
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
        {/* This month savings goal */}
        <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
          <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: '#6B6459' }}>
            Meta de ahorro · este mes
          </p>
          <div className="flex items-center gap-5">
            <div className="shrink-0">
              <DonutChart
                segments={[
                  { label: 'Ahorrado', value: Math.max(current.saved, 0), color: targetReached ? '#7EC8A4' : '#F5A623' },
                  { label: 'Falta', value: Math.max(targetAmount - current.saved, 0), color: '#ECE5DC' },
                ]}
                centerTop="Ahorro"
                centerBottom={`${current.income > 0 ? Math.round((current.saved / current.income) * 100) : 0}%`}
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold" style={{ color: '#6B6459' }}>Quiero ahorrar</p>
              <div className="flex items-center gap-3 my-1">
                <button
                  onClick={() => changeTarget(-5)}
                  className="w-8 h-8 rounded-full text-lg font-black flex items-center justify-center"
                  style={{ background: '#ECE5DC', color: '#2D2D2D' }}
                >
                  −
                </button>
                <p className="text-2xl font-black tabular-nums" style={{ color: '#2D2D2D' }}>{targetPct}%</p>
                <button
                  onClick={() => changeTarget(5)}
                  className="w-8 h-8 rounded-full text-lg font-black flex items-center justify-center"
                  style={{ background: '#E4F2EA', color: '#5BA886' }}
                >
                  +
                </button>
              </div>
              <p className="text-xs" style={{ color: '#6B6459' }}>
                = {formatARS(targetAmount)} sobre {formatARS(current.income)} de ingresos
              </p>
            </div>
          </div>

          {/* Progress */}
          <div className="mt-4">
            <div className="h-2.5 rounded-full overflow-hidden" style={{ background: '#ECE5DC' }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${progressPct * 100}%`, background: targetReached ? '#7EC8A4' : '#F5A623' }}
              />
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-xs font-bold" style={{ color: targetReached ? '#5BA886' : '#B8860B' }}>
                Ahorrado {formatARS(Math.max(current.saved, 0))}
              </span>
              <span className="text-xs" style={{ color: '#6B6459' }}>
                {targetReached ? '¡Meta cumplida! 🎉' : `faltan ${formatARS(Math.max(targetAmount - current.saved, 0))}`}
              </span>
            </div>
          </div>
        </div>

        {/* 6-month evolution */}
        <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#6B6459' }}>
              Ingresos vs gastos · 6 meses
            </p>
          </div>
          <div className="flex items-center gap-4 mb-4 text-[11px]">
            <span className="flex items-center gap-1.5" style={{ color: '#5BA886' }}>
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#7EC8A4' }} /> Ingresos
            </span>
            <span className="flex items-center gap-1.5" style={{ color: '#E5604C' }}>
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#FF7F6B' }} /> Gastos
            </span>
            <span className="ml-auto" style={{ color: '#6B6459' }}>% = ahorro del mes</span>
          </div>
          <MonthlyBars rows={rows} />
          {avgRate != null && (
            <p className="text-xs mt-4 pt-3 text-center" style={{ borderTop: '1px solid #ECE5DC', color: '#6B6459' }}>
              Promedio de ahorro de 6 meses:{' '}
              <span className="font-black" style={{ color: avgRate >= 0 ? '#5BA886' : '#E5604C' }}>
                {Math.round(avgRate * 100)}%
              </span>{' '}
              · {formatARS(sixMoSaved)} ahorrados
            </p>
          )}
        </div>
      </div>

      <BottomNav onFab={(type) => { setFabType(type); setSheetOpen(true); }} />
      <AddTransactionSheet
        open={sheetOpen}
        initialType={fabType}
        onClose={() => setSheetOpen(false)}
        householdId={profile.household_id}
        profileId={profile.id}
        categories={[]}
        accounts={[]}
      />
    </div>
  );
}
