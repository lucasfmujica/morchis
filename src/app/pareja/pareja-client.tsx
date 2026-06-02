'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { useFx } from '@/hooks/useFx';
import { useCoupleBalance, recordSettlement } from '@/hooks/useCouple';
import { BottomNav } from '@/components/BottomNav';
import { AddTransactionSheet } from '@/components/AddTransactionSheet';
import { InvitePartnerModal } from '@/components/InvitePartnerModal';
import { formatARS } from '@/lib/format';
import { toast } from 'sonner';
import Link from 'next/link';

interface Profile {
  id: string;
  household_id: string;
  nickname: string | null;
  display_name: string | null;
}

interface Partner {
  id: string;
  name: string;
}

function SettleUpSheet({
  open,
  onClose,
  net,
  myName,
  partnerName,
  householdId,
  myProfileId,
  partnerProfileId,
}: {
  open: boolean;
  onClose: () => void;
  net: number;
  myName: string;
  partnerName: string;
  householdId: string;
  myProfileId: string;
  partnerProfileId: string;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Who owes whom
  // net > 0 → partner owes me → partner pays me
  // net < 0 → I owe partner → I pay partner
  const absNet = Math.abs(net);
  const iOwe = net < 0;

  if (!open) return null;

  async function handleSettle() {
    if (absNet === 0) return;
    setSaving(true);
    try {
      await recordSettlement({
        householdId,
        fromProfileId: iOwe ? myProfileId : partnerProfileId,
        toProfileId: iOwe ? partnerProfileId : myProfileId,
        amount: absNet,
        note,
      });
      await qc.invalidateQueries({ queryKey: ['couple-balance'] });
      await qc.invalidateQueries({ queryKey: ['couple-transactions'] });
      toast.success('¡Saldo saldado! Balance en cero ✓');
      onClose();
      setNote('');
    } catch {
      toast.error('No se pudo registrar. Intentá de nuevo.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div
        className="w-full rounded-t-3xl p-6"
        style={{ background: '#F9F5F0' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center mb-4">
          <div className="w-10 h-1 rounded-full" style={{ background: '#ECE5DC' }} />
        </div>

        <h2 className="text-xl font-black mb-1" style={{ color: '#2D2D2D' }}>Saldar deuda</h2>
        <p className="text-sm mb-5" style={{ color: '#8A8276' }}>
          {iOwe
            ? `Le pagás ${formatARS(absNet)} a ${partnerName}`
            : `${partnerName} te paga ${formatARS(absNet)}`}
        </p>

        <div
          className="rounded-2xl p-4 mb-4 text-center"
          style={{ background: iOwe ? '#FFE7E2' : '#E4F2EA' }}
        >
          <p className="text-3xl font-black" style={{ color: iOwe ? '#E5604C' : '#5BA886' }}>
            {formatARS(absNet)}
          </p>
          <p className="text-xs mt-1" style={{ color: iOwe ? '#E5604C' : '#5BA886', opacity: 0.75 }}>
            {iOwe ? `${myName} → ${partnerName}` : `${partnerName} → ${myName}`}
          </p>
        </div>

        <input
          type="text"
          placeholder="Nota (opcional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full px-4 py-3 rounded-2xl text-sm border bg-white outline-none mb-4"
          style={{ borderColor: '#ECE5DC', color: '#2D2D2D' }}
        />

        <button
          onClick={handleSettle}
          disabled={saving || absNet === 0}
          className="w-full py-4 rounded-2xl text-lg font-black text-white disabled:opacity-40"
          style={{ background: '#FF7F6B' }}
        >
          {saving ? 'Guardando…' : 'Confirmar pago'}
        </button>
      </div>
    </div>
  );
}

export default function ParejaClient({
  profile,
  partner,
}: {
  profile: Profile;
  partner?: Partner;
}) {
  const supabase = createClient();
  const qc = useQueryClient();
  const { format, showUSD, arsPerUsd, toggle } = useFx();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fabType, setFabType] = useState<'expense' | 'income'>('expense');
  const [settleOpen, setSettleOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const myName = profile.nickname || profile.display_name || 'Yo';

  const { net, loading: balanceLoading } = useCoupleBalance(
    profile.household_id,
    profile.id,
    partner?.id,
  );

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

  // Current month combined transactions
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  const { data: txData } = useQuery({
    queryKey: ['couple-transactions', profile.household_id, monthStart],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('amount, type, scope, profile_id, category_id, is_shared, categories(name, icon)')
        .eq('household_id', profile.household_id)
        .gte('occurred_on', monthStart)
        .order('occurred_on', { ascending: false });
      return data ?? [];
    },
  });

  const allTx = txData ?? [];
  const expenses = allTx.filter((t) => t.type === 'expense');
  const incomes = allTx.filter((t) => t.type === 'income');
  const totalExpenses = expenses.reduce((s, t) => s + t.amount, 0);
  const totalIncome = incomes.reduce((s, t) => s + t.amount, 0);
  const householdExpenses = expenses.filter((t) => t.scope === 'household').reduce((s, t) => s + t.amount, 0);
  const personalExpenses = expenses.filter((t) => t.scope === 'personal').reduce((s, t) => s + t.amount, 0);
  const sharedExpenses = expenses.filter((t) => t.is_shared).reduce((s, t) => s + t.amount, 0);

  // Category breakdown for shared expenses
  const sharedByCategory: Record<string, { name: string; icon: string; amount: number }> = {};
  for (const t of expenses.filter((t) => t.is_shared)) {
    const cat = (t as unknown as { categories: { name: string; icon: string } | null }).categories;
    const key = t.category_id ?? 'sin-categoria';
    if (!sharedByCategory[key]) {
      sharedByCategory[key] = { name: cat?.name ?? 'Sin categoría', icon: cat?.icon ?? '🏷️', amount: 0 };
    }
    sharedByCategory[key].amount += t.amount;
  }
  const sharedCats = Object.values(sharedByCategory).sort((a, b) => b.amount - a.amount);

  const absNet = Math.abs(net);
  const partnerOwesMe = net > 0;
  const iOwePartner = net < 0;
  const balanced = net === 0;

  const f = (n: number) =>
    showUSD && arsPerUsd > 0
      ? `US$${Math.round(n / arsPerUsd).toLocaleString('es-AR')}`
      : formatARS(n);

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F9F5F0' }}>
      <header className="flex items-center gap-3 px-5 pt-14 pb-4">
        <Link href="/mas" style={{ color: '#8A8276', fontSize: 22 }}>←</Link>
        <div className="flex-1">
          <h1 className="text-2xl font-black" style={{ color: '#2D2D2D' }}>Vista de pareja</h1>
          {partner && <p className="text-xs" style={{ color: '#8A8276' }}>{myName} & {partner.name}</p>}
        </div>
        <button
          onClick={toggle}
          className="text-sm font-bold px-3 py-1.5 rounded-full border"
          style={{ borderColor: '#7EC8A4', color: '#7EC8A4' }}
        >
          {showUSD ? 'USD' : 'ARS'}
        </button>
      </header>

      {/* Combined summary */}
      <div className="mx-4 rounded-3xl p-5 mb-4 shadow-sm" style={{ background: '#FFFFFF' }}>
        <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: '#8A8276' }}>
          Resumen del mes
        </p>
        <div className="flex gap-4">
          <div className="flex-1 rounded-2xl p-3" style={{ background: '#E4F2EA' }}>
            <p className="text-[10px] font-bold uppercase mb-1" style={{ color: '#5BA886' }}>Ingresos</p>
            <p className="text-lg font-black" style={{ color: '#5BA886', fontVariantNumeric: 'tabular-nums' }}>{f(totalIncome)}</p>
          </div>
          <div className="flex-1 rounded-2xl p-3" style={{ background: '#FFE7E2' }}>
            <p className="text-[10px] font-bold uppercase mb-1" style={{ color: '#E5604C' }}>Gastos</p>
            <p className="text-lg font-black" style={{ color: '#E5604C', fontVariantNumeric: 'tabular-nums' }}>{f(totalExpenses)}</p>
          </div>
        </div>

        {/* Household vs personal */}
        <div className="mt-4 pt-4" style={{ borderTop: '1px solid #ECE5DC' }}>
          <div className="flex justify-between mb-2">
            <p className="text-xs" style={{ color: '#8A8276' }}>🏠 Hogar</p>
            <p className="text-xs font-bold" style={{ color: '#2D2D2D' }}>{f(householdExpenses)}</p>
          </div>
          <div className="flex justify-between">
            <p className="text-xs" style={{ color: '#8A8276' }}>👤 Personal</p>
            <p className="text-xs font-bold" style={{ color: '#2D2D2D' }}>{f(personalExpenses)}</p>
          </div>
        </div>
      </div>

      {/* Who owes whom */}
      {!partner ? (
        <div className="mx-4 rounded-3xl p-5 mb-4 text-center" style={{ background: '#FFFFFF' }}>
          <p className="text-3xl mb-2">👫</p>
          <p className="text-sm font-bold" style={{ color: '#2D2D2D' }}>Todavía no hay pareja vinculada al hogar</p>
          <p className="text-sm mt-1 mb-4" style={{ color: '#8A8276' }}>
            Invitá a tu pareja para compartir esta vista y dividir gastos.
          </p>
          <button
            onClick={() => setInviteOpen(true)}
            className="px-5 py-3 rounded-2xl text-sm font-black text-white"
            style={{ background: '#7EC8A4' }}
          >
            💌 Invitar a mi pareja
          </button>
        </div>
      ) : (
        <div
          className="mx-4 rounded-3xl p-5 mb-4 shadow-sm"
          style={{ background: balanced ? '#FFFFFF' : partnerOwesMe ? '#E4F2EA' : '#FFE7E2' }}
        >
          <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: '#8A8276' }}>
            Quién le debe a quién
          </p>

          {balanceLoading ? (
            <p className="text-sm" style={{ color: '#8A8276' }}>Calculando…</p>
          ) : balanced ? (
            <div className="text-center py-2">
              <p className="text-3xl mb-1">🤝</p>
              <p className="text-base font-black" style={{ color: '#2D2D2D' }}>¡Estamos al día!</p>
              <p className="text-xs mt-1" style={{ color: '#8A8276' }}>No hay deudas pendientes entre ustedes.</p>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-3 mb-3">
                <div className="flex-1">
                  <p className="text-xs mb-0.5" style={{ color: partnerOwesMe ? '#5BA886' : '#E5604C', opacity: 0.8 }}>
                    {partnerOwesMe ? `${partner.name} te debe` : `Le debés a ${partner.name}`}
                  </p>
                  <p
                    className="text-3xl font-black"
                    style={{ color: partnerOwesMe ? '#5BA886' : '#E5604C', fontVariantNumeric: 'tabular-nums' }}
                  >
                    {f(absNet)}
                  </p>
                </div>
                <button
                  onClick={() => setSettleOpen(true)}
                  className="px-4 py-2.5 rounded-2xl text-sm font-black text-white"
                  style={{ background: '#FF7F6B' }}
                >
                  Saldar
                </button>
              </div>
              <p className="text-xs" style={{ color: partnerOwesMe ? '#5BA886' : '#E5604C', opacity: 0.7 }}>
                {partnerOwesMe
                  ? `Pagaste gastos compartidos que ${partner.name} aún no compensó.`
                  : `${partner.name} pagó gastos compartidos que todavía no compensaste.`}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Shared category breakdown */}
      {sharedCats.length > 0 && (
        <div className="mx-4 rounded-3xl p-5 mb-4 shadow-sm" style={{ background: '#FFFFFF' }}>
          <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: '#8A8276' }}>
            Gastos compartidos por categoría
          </p>
          <div className="flex flex-col gap-2">
            {sharedCats.map((cat) => {
              const pct = totalExpenses > 0 ? cat.amount / totalExpenses : 0;
              return (
                <div key={cat.name}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span>{cat.icon}</span>
                      <p className="text-sm font-semibold" style={{ color: '#2D2D2D' }}>{cat.name}</p>
                    </div>
                    <p className="text-sm font-bold" style={{ color: '#2D2D2D' }}>{f(cat.amount)}</p>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#ECE5DC' }}>
                    <div
                      className="h-full rounded-full"
                      style={{ background: '#7EC8A4', width: `${Math.min(pct * 100, 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs mt-3" style={{ color: '#8A8276' }}>
            Total compartido este mes: <strong>{f(sharedExpenses)}</strong>
          </p>
        </div>
      )}

      <BottomNav onFab={(type) => { setFabType(type); setSheetOpen(true); }} />

      <AddTransactionSheet
        open={sheetOpen}
        initialType={fabType}
        onClose={() => setSheetOpen(false)}
        householdId={profile.household_id}
        profileId={profile.id}
        partnerProfileId={partner?.id}
        categories={categories}
        accounts={accounts}
      />

      {partner && (
        <SettleUpSheet
          open={settleOpen}
          onClose={() => setSettleOpen(false)}
          net={net}
          myName={myName}
          partnerName={partner.name}
          householdId={profile.household_id}
          myProfileId={profile.id}
          partnerProfileId={partner.id}
        />
      )}

      <InvitePartnerModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  );
}
