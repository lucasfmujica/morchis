'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { useFx } from '@/hooks/useFx';
import { BottomNav } from '@/components/BottomNav';
import { AddTransactionSheet } from '@/components/AddTransactionSheet';

interface Profile {
  id: string;
  household_id: string;
  nickname: string | null;
  display_name: string | null;
}

export default function HomeClient({ profile, partnerProfileId }: { profile: Profile; partnerProfileId?: string }) {
  const supabase = createClient();
  const { format, secondary, toggle, showUSD } = useFx();
  const [sheetOpen, setSheetOpen] = useState(false);
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

  const { data: monthData } = useQuery({
    queryKey: ['summary', profile.household_id],
    queryFn: async () => {
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const { data } = await supabase
        .from('transactions')
        .select('amount, type')
        .eq('household_id', profile.household_id)
        .gte('occurred_on', `${month}-01`);
      if (!data) return { expenses: 0, income: 0, balance: 0 };
      const expenses = data.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
      const income = data.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
      return { expenses, income, balance: income - expenses };
    },
  });

  const balance = monthData?.balance ?? 0;
  const expenses = monthData?.expenses ?? 0;
  const income = monthData?.income ?? 0;
  const balancePositive = balance >= 0;

  const greetingHour = new Date().getHours();
  const greeting = greetingHour < 12 ? 'Buenos días' : greetingHour < 19 ? 'Buenas tardes' : 'Buenas noches';

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

      {/* Hero balance card */}
      <div className="mx-4 rounded-3xl p-6 shadow-sm mb-4" style={{ background: '#FFFFFF' }}>
        <p className="text-sm font-semibold mb-1" style={{ color: '#8A8276' }}>Balance del mes</p>
        <p
          className="text-4xl font-black mb-1"
          style={{ color: balancePositive ? '#7EC8A4' : '#FF7F6B' }}
        >
          {format(Math.abs(balance))}
          {!balancePositive && <span className="text-2xl"> (negativo)</span>}
        </p>
        <p className="text-xs" style={{ color: '#8A8276' }}>{secondary(Math.abs(balance))}</p>
        {balance === 0 && income === 0 && expenses === 0 && (
          <p className="text-sm mt-3" style={{ color: '#7EC8A4' }}>
            Todavía no hay movimientos este mes. Tocá + para empezar.
          </p>
        )}
      </div>

      {/* Income / Expenses row */}
      {(income > 0 || expenses > 0) && (
        <div className="mx-4 flex gap-3 mb-4">
          <div className="flex-1 rounded-3xl p-4" style={{ background: '#FFFFFF' }}>
            <p className="text-xs font-semibold mb-1" style={{ color: '#8A8276' }}>Ingresos</p>
            <p className="text-lg font-black" style={{ color: '#7EC8A4' }}>{format(income)}</p>
            <p className="text-xs" style={{ color: '#8A8276' }}>{secondary(income)}</p>
          </div>
          <div className="flex-1 rounded-3xl p-4" style={{ background: '#FFFFFF' }}>
            <p className="text-xs font-semibold mb-1" style={{ color: '#8A8276' }}>Gastos</p>
            <p className="text-lg font-black" style={{ color: '#FF7F6B' }}>{format(expenses)}</p>
            <p className="text-xs" style={{ color: '#8A8276' }}>{secondary(expenses)}</p>
          </div>
        </div>
      )}

      {/* Quick links */}
      <div className="mx-4 rounded-3xl overflow-hidden mb-4" style={{ background: '#FFFFFF' }}>
        {[
          { href: '/movimientos', icon: '📋', label: 'Ver movimientos' },
          { href: '/cuentas', icon: '🏦', label: 'Mis cuentas' },
          { href: '/categorias', icon: '🏷️', label: 'Categorías' },
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

      <BottomNav onFab={() => setSheetOpen(true)} />

      <AddTransactionSheet
        open={sheetOpen}
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
