'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { useFx } from '@/hooks/useFx';
import { usePushSubscription } from '@/hooks/usePushSubscription';
import { BottomNav } from '@/components/BottomNav';
import { AddTransactionSheet } from '@/components/AddTransactionSheet';
import { CoupleBalanceChip } from '@/components/CoupleBalanceChip';
import { InsightTopCard } from '@/components/InsightTopCard';
import { computeProjection } from '@/lib/projection';
import { formatARS } from '@/lib/format';

interface Profile {
  id: string;
  household_id: string;
  nickname: string | null;
  display_name: string | null;
}

import Link from 'next/link';

function BudgetSummaryCard({
  budgets,
  spentByCategory,
}: {
  budgets: { id: string; category_id: string; scope: string; amount: number }[];
  spentByCategory: Record<string, number>;
}) {
  if (budgets.length === 0) {
    return (
      <Link href="/presupuestos" className="mx-4 rounded-3xl p-5 mb-4 flex items-center justify-between" style={{ background: '#FFFFFF' }}>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: '#8A8276' }}>Presupuesto del mes</p>
          <p className="text-sm" style={{ color: '#8A8276' }}>Tocá para crear presupuestos →</p>
        </div>
      </Link>
    );
  }

  const totalBudget = budgets.reduce((s, b) => s + b.amount, 0);
  const totalSpent = budgets.reduce((s, b) => s + (spentByCategory[b.category_id] ?? 0), 0);
  const pct = totalBudget > 0 ? totalSpent / totalBudget : 0;
  const over = totalSpent > totalBudget;
  const barColor = pct >= 1 ? '#FF7F6B' : pct >= 0.8 ? '#F5A623' : '#7EC8A4';

  return (
    <Link href="/presupuestos" className="mx-4 rounded-3xl p-5 mb-4 block" style={{ background: '#FFFFFF' }}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#8A8276' }}>Presupuesto del mes</p>
        {over && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#FFE7E2', color: '#FF7F6B' }}>
            Excedido
          </span>
        )}
      </div>
      <div className="h-3 rounded-full overflow-hidden" style={{ background: '#ECE5DC' }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ background: barColor, width: `${Math.min(pct * 100, 100)}%` }}
        />
      </div>
      <div className="flex justify-between mt-2">
        <p className="text-xs font-semibold" style={{ color: barColor }}>{formatARS(totalSpent)} gastado</p>
        <p className="text-xs" style={{ color: over ? '#FF7F6B' : '#8A8276' }}>
          {over ? `+${formatARS(totalSpent - totalBudget)} excedido` : `de ${formatARS(totalBudget)}`}
        </p>
      </div>
    </Link>
  );
}

// Inline SVG sparkline — no external dep needed
function Sparkline({ values, positive }: { values: number[]; positive: boolean }) {
  if (values.length < 2) return null;
  const w = 120;
  const h = 32;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: 'visible' }}>
      <polyline
        points={pts}
        fill="none"
        stroke={positive ? '#7EC8A4' : '#FF7F6B'}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function HomeClient({
  profile,
  partnerProfileId,
  partnerName,
}: {
  profile: Profile;
  partnerProfileId?: string;
  partnerName?: string;
}) {
  const supabase = createClient();
  const { format, secondary, toggle, showUSD, arsPerUsd } = useFx();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fabType, setFabType] = useState<'expense' | 'income'>('expense');
  usePushSubscription(profile.id);
  // scope: 'all' | 'me' | 'partner'
  const [scope, setScope] = useState<'all' | 'me' | 'partner'>('all');
  const name = profile.nickname || profile.display_name || 'Morch';

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase.from('categories').select('id, name, icon, kind').eq('household_id', profile.household_id).order('name');
      return data ?? [];
    },
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase.from('accounts').select('id, name, type').eq('household_id', profile.household_id).eq('archived', false).order('name');
      return data ?? [];
    },
  });

  // Load all transactions for current month
  const { data: transactions = [] } = useQuery({
    queryKey: ['transactions', profile.household_id, 'month'],
    queryFn: async () => {
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const { data } = await supabase
        .from('transactions')
        .select('amount, type, occurred_on, profile_id')
        .eq('household_id', profile.household_id)
        .gte('occurred_on', `${month}-01`);
      return data ?? [];
    },
  });

  // Load budgets for current month summary
  const monthStart = (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  })();

  const { data: budgets = [] } = useQuery({
    queryKey: ['budgets', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('budgets')
        .select('id, category_id, scope, amount')
        .eq('household_id', profile.household_id)
        .eq('active', true);
      return data ?? [];
    },
  });

  const { data: spentByCategory = {} } = useQuery<Record<string, number>>({
    queryKey: ['spent-by-category', profile.household_id, monthStart],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('category_id, amount')
        .eq('household_id', profile.household_id)
        .eq('type', 'expense')
        .gte('occurred_on', monthStart);
      const map: Record<string, number> = {};
      for (const t of data ?? []) {
        if (!t.category_id) continue;
        map[t.category_id] = (map[t.category_id] ?? 0) + t.amount;
      }
      return map;
    },
  });

  // Load active recurring rules
  const { data: rules = [] } = useQuery({
    queryKey: ['recurring_rules', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('recurring_rules')
        .select('direction, amount, next_run, active, profile_id')
        .eq('household_id', profile.household_id)
        .eq('active', true);
      return data ?? [];
    },
  });

  const scopeProfileId =
    scope === 'me' ? profile.id : scope === 'partner' ? partnerProfileId : undefined;

  const projection = computeProjection(
    transactions.map((t) => ({
      type: t.type as 'income' | 'expense' | 'transfer',
      amount: t.amount,
      occurred_on: t.occurred_on,
      profile_id: t.profile_id,
    })),
    rules.map((r) => ({
      direction: r.direction as 'income' | 'expense',
      amount: r.amount,
      next_run: r.next_run,
      active: r.active,
      profile_id: r.profile_id,
    })),
    new Date(),
    scopeProfileId,
  );

  const { projectedBalance, incomeSoFar, expensesSoFar, dailyBalances } = projection;
  const isPositive = projectedBalance >= 0;

  const greetingHour = new Date().getHours();
  const greeting = greetingHour < 12 ? 'Buenos días' : greetingHour < 19 ? 'Buenas tardes' : 'Buenas noches';

  const scopeTabs = [
    { key: 'all' as const, label: 'Nuestro' },
    { key: 'me' as const, label: 'Mío' },
    ...(partnerProfileId ? [{ key: 'partner' as const, label: partnerName || 'Sofi' }] : []),
  ];

  const projectedUsd = showUSD && arsPerUsd > 0
    ? `≈ US$${Math.round(Math.abs(projectedBalance) / arsPerUsd).toLocaleString('es-AR')}`
    : formatARS(Math.abs(projectedBalance));

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F9F5F0' }}>
      {/* Header */}
      <header className="flex items-center justify-between px-5 pt-14 pb-4">
        <div>
          <p className="text-sm" style={{ color: '#8A8276' }}>{greeting},</p>
          <h1 className="text-2xl font-black" style={{ color: '#2D2D2D' }}>{name} 👋</h1>
        </div>
        <button
          onClick={toggle}
          className="text-sm font-bold px-3 py-1.5 rounded-full border"
          style={{ borderColor: '#7EC8A4', color: '#7EC8A4' }}
        >
          {showUSD ? 'USD' : 'ARS'}
        </button>
      </header>

      {/* Scope toggle */}
      <div className="mx-4 mb-3 flex rounded-2xl overflow-hidden p-1 gap-1" style={{ background: '#ECE5DC' }}>
        {scopeTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setScope(tab.key)}
            className="flex-1 py-1.5 text-xs font-bold rounded-xl transition-colors"
            style={{
              background: scope === tab.key ? '#FFFFFF' : 'transparent',
              color: scope === tab.key ? '#2D2D2D' : '#8A8276',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Hero projection card */}
      <div
        className="mx-4 rounded-3xl p-5 shadow-sm mb-4"
        style={{ background: isPositive ? '#E4F2EA' : '#FFE7E2' }}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: isPositive ? '#5BA886' : '#E5604C' }}>
              Proyección fin de mes
            </p>
            <p
              className="text-4xl font-black leading-none mb-1"
              style={{ color: isPositive ? '#5BA886' : '#E5604C', fontVariantNumeric: 'tabular-nums' }}
            >
              {!isPositive && '−'}{showUSD && arsPerUsd > 0
                ? `US$${Math.round(Math.abs(projectedBalance) / arsPerUsd).toLocaleString('es-AR')}`
                : formatARS(Math.abs(projectedBalance))}
            </p>
            <p className="text-xs" style={{ color: isPositive ? '#5BA886' : '#E5604C', opacity: 0.75 }}>
              {showUSD
                ? (!isPositive ? '−' : '') + formatARS(Math.abs(projectedBalance))
                : arsPerUsd > 0
                  ? `≈ US$${Math.round(Math.abs(projectedBalance) / arsPerUsd).toLocaleString('es-AR')}`
                  : ''}
            </p>
          </div>
          <Sparkline values={dailyBalances} positive={isPositive} />
        </div>

        {/* Detail row */}
        <div className="flex gap-4 mt-3 pt-3" style={{ borderTop: `1px solid ${isPositive ? '#5BA88640' : '#E5604C40'}` }}>
          <div>
            <p className="text-xs" style={{ color: isPositive ? '#5BA886' : '#E5604C', opacity: 0.75 }}>Ingresos</p>
            <p className="text-sm font-bold" style={{ color: isPositive ? '#5BA886' : '#E5604C' }}>{formatARS(incomeSoFar)}</p>
          </div>
          <div>
            <p className="text-xs" style={{ color: isPositive ? '#5BA886' : '#E5604C', opacity: 0.75 }}>Gastos</p>
            <p className="text-sm font-bold" style={{ color: isPositive ? '#5BA886' : '#E5604C' }}>{formatARS(expensesSoFar)}</p>
          </div>
          <div>
            <p className="text-xs" style={{ color: isPositive ? '#5BA886' : '#E5604C', opacity: 0.75 }}>Días rest.</p>
            <p className="text-sm font-bold" style={{ color: isPositive ? '#5BA886' : '#E5604C' }}>{projection.daysRemaining}</p>
          </div>
        </div>

        {incomeSoFar === 0 && expensesSoFar === 0 && (
          <p className="text-xs mt-3" style={{ color: isPositive ? '#5BA886' : '#E5604C' }}>
            Todavía no hay movimientos este mes. Tocá + para registrar un ingreso o gasto.
          </p>
        )}
      </div>

      {/* Couple balance chip */}
      <CoupleBalanceChip
        householdId={profile.household_id}
        myProfileId={profile.id}
        partnerProfileId={partnerProfileId}
        partnerName={partnerName}
      />

      {/* AI insight card */}
      <InsightTopCard householdId={profile.household_id} profileId={profile.id} />

      {/* Spent-vs-budget */}
      <BudgetSummaryCard budgets={budgets} spentByCategory={spentByCategory} />

      {/* Quick links */}
      <div className="mx-4 rounded-3xl overflow-hidden mb-4" style={{ background: '#FFFFFF' }}>
        {[
          { href: '/movimientos', icon: '📋', label: 'Ver movimientos' },
          { href: '/insights', icon: '✨', label: 'Todos los insights' },
          { href: '/presupuestos', icon: '📊', label: 'Presupuestos' },
        ].map((item, i) => (
          <a
            key={item.href}
            href={item.href}
            className="flex items-center gap-3 px-5 py-4"
            style={{ borderTop: i > 0 ? '1px solid #ECE5DC' : 'none' }}
          >
            <span className="text-2xl">{item.icon}</span>
            <p className="flex-1 font-semibold text-sm" style={{ color: '#2D2D2D' }}>{item.label}</p>
            <span style={{ color: '#8A8276' }}>→</span>
          </a>
        ))}
      </div>

      <BottomNav onFab={(type) => { setFabType(type); setSheetOpen(true); }} />

      <AddTransactionSheet
        open={sheetOpen}
        initialType={fabType}
        onClose={() => setSheetOpen(false)}
        householdId={profile.household_id}
        profileId={profile.id}
        partnerProfileId={partnerProfileId}
        categories={categories}
        accounts={accounts}
      />
    </div>
  );
}
