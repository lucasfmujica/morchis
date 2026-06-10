'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { useFx } from '@/hooks/useFx';
import { useCoupleBalance, recordSettlement } from '@/hooks/useCouple';
import { BottomNav } from '@/components/BottomNav';
import { AddTransactionSheet } from '@/components/AddTransactionSheet';
import { InvitePartnerModal } from '@/components/InvitePartnerModal';
import { formatARS } from '@/lib/format';
import { MoneyInput } from '@/components/MoneyInput';
import { todayISO, toLocalISO } from '@/lib/date';
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

interface SettleAccount {
  id: string;
  name: string;
  type: string;
  currency: string;
  owner_profile_id?: string | null;
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
  accounts,
  fmt,
}: {
  open: boolean;
  onClose: () => void;
  net: number;
  myName: string;
  partnerName: string;
  householdId: string;
  myProfileId: string;
  partnerProfileId: string;
  accounts: SettleAccount[];
  fmt: (n: number) => string;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  // Amount being settled, in ARS. Defaults to the full balance but can be a
  // partial payment — or larger than the balance, which flips who owes whom.
  // 0 = empty field, which falls back to the full balance.
  const [amountVal, setAmountVal] = useState(0);
  const [date, setDate] = useState(todayISO());
  // When on, the payment also moves real money between the partners' accounts
  // (a transfer), not just the abstract couple balance. Off = cash / external.
  const [moveMoney, setMoveMoney] = useState(true);
  const [fromAccountId, setFromAccountId] = useState<string | null>(null);
  const [toAccountId, setToAccountId] = useState<string | null>(null);
  // Payment direction, chosen explicitly. Either person can pay the other
  // regardless of who currently owes — paying against the balance just shifts
  // it the other way. Defaults to the direction that settles the debt.
  const [iPay, setIPay] = useState(net < 0);

  // net > 0 → partner owes me; net < 0 → I owe partner.
  const absNet = Math.round(Math.abs(net));
  // No upper cap: paying any amount is valid; the resulting balance is derived.
  const amount = amountVal > 0 ? Math.round(amountVal) : absNet;

  // The payer is whoever the direction toggle says; the receiver is the other.
  // Money legs are filtered to each side's own non-credit ARS accounts (the
  // couple ledger is in ARS).
  const payerProfileId = iPay ? myProfileId : partnerProfileId;
  const receiverProfileId = iPay ? partnerProfileId : myProfileId;
  const payerName = iPay ? myName : partnerName;
  const receiverName = iPay ? partnerName : myName;

  // Resulting couple balance from my perspective: paying my partner pushes the
  // balance toward "partner owes me" (+); the partner paying me pushes it the
  // other way (−). Drives every preview/toast message, in any direction.
  const newNet = net + (iPay ? amount : -amount);
  const settledExactly = Math.abs(newNet) < 1;
  const eligible = (ownerId: string) =>
    accounts.filter(
      (a) => a.type !== 'credit' && a.currency === 'ARS' && (a.owner_profile_id == null || a.owner_profile_id === ownerId),
    );
  const fromAccounts = eligible(payerProfileId);
  const toAccounts = eligible(receiverProfileId);
  const canMoveMoney = fromAccounts.length > 0 && toAccounts.length > 0;
  const effectiveFromId =
    fromAccountId && fromAccounts.some((a) => a.id === fromAccountId) ? fromAccountId : (fromAccounts[0]?.id ?? null);
  const effectiveToId =
    toAccountId && toAccounts.some((a) => a.id === toAccountId) ? toAccountId : (toAccounts[0]?.id ?? null);
  const willMoveMoney = moveMoney && canMoveMoney && !!effectiveFromId && !!effectiveToId;

  // Reset the form whenever the sheet (re)opens.
  useEffect(() => {
    if (open) {
      setAmountVal(0);
      setDate(todayISO());
      setMoveMoney(true);
      setFromAccountId(null);
      setToAccountId(null);
      // Default to the direction that settles the current balance.
      setIPay(net < 0);
    }
  }, [open, absNet, net]);

  if (!open) return null;

  async function handleSettle() {
    if (amount <= 0) return;
    setSaving(true);
    try {
      await recordSettlement({
        householdId,
        fromProfileId: payerProfileId,
        toProfileId: receiverProfileId,
        amount,
        note,
        occurredOn: date,
        fromAccountId: willMoveMoney ? effectiveFromId : null,
        toAccountId: willMoveMoney ? effectiveToId : null,
      });
      // Invalidate the couple balance plus everything a money movement touches,
      // so account balances and net worth refresh when this also moved money.
      await Promise.all(
        ['couple-balance', 'couple-transactions', 'transactions', 'account-tx', 'summary', 'projection'].map((key) =>
          qc.invalidateQueries({ queryKey: [key] }),
        ),
      );
      toast.success(
        settledExactly
          ? '¡Quedaron a mano! Balance en cero ✓'
          : newNet > 0
            ? `Pago registrado. ${partnerName} te debe ${fmt(newNet)} ✓`
            : `Pago registrado. Le debés ${fmt(-newNet)} a ${partnerName} ✓`,
      );
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

        <h2 className="text-xl font-black mb-1" style={{ color: '#2D2D2D' }}>Registrar pago</h2>
        <p className="text-sm mb-4" style={{ color: '#6B6459' }}>
          {absNet < 1
            ? 'Están a mano.'
            : net > 0
              ? `${partnerName} te debe ${fmt(absNet)}`
              : `Le debés ${fmt(absNet)} a ${partnerName}`}
        </p>

        {/* Direction — either person can pay the other, regardless of who owes. */}
        <p className="text-xs font-bold mb-1.5" style={{ color: '#6B6459' }}>¿Quién le paga a quién?</p>
        <div className="flex rounded-2xl overflow-hidden p-1 gap-1 mb-4" style={{ background: '#ECE5DC' }}>
          {([
            { key: true, label: `👤 ${myName} → ${partnerName}` },
            { key: false, label: `👥 ${partnerName} → ${myName}` },
          ] as const).map((o) => {
            const active = iPay === o.key;
            return (
              <button
                key={String(o.key)}
                onClick={() => setIPay(o.key)}
                className="flex-1 py-2 text-xs font-bold rounded-xl transition-colors"
                style={{ background: active ? '#FFFFFF' : 'transparent', color: active ? '#2D2D2D' : '#6B6459' }}
              >
                {o.label}
              </button>
            );
          })}
        </div>

        <div
          className="rounded-2xl p-4 mb-4 text-center"
          style={{ background: iPay ? '#FFE7E2' : '#E4F2EA' }}
        >
          <p className="text-3xl font-black" style={{ color: iPay ? '#E5604C' : '#5BA886' }}>
            {fmt(amount)}
          </p>
          <p className="text-xs mt-1" style={{ color: iPay ? '#E5604C' : '#5BA886', opacity: 0.75 }}>
            {payerName} → {receiverName}
          </p>
        </div>

        {/* Amount — defaults to the current balance; type any amount you want. */}
        <p className="text-xs font-bold mb-1.5" style={{ color: '#6B6459' }}>¿Cuánto paga? (ARS)</p>
        <div className="flex items-center gap-2 mb-2">
          {/* MoneyInput handles the es-AR convention ('.' thousands, ',' decimal),
              so typing "15.000" means fifteen thousand, not fifteen pesos. */}
          <MoneyInput
            value={amountVal}
            onChange={setAmountVal}
            placeholder={absNet.toLocaleString('es-AR')}
            className="flex-1 px-4 py-3 rounded-2xl text-sm border bg-white outline-none"
            style={{ borderColor: '#ECE5DC', color: '#2D2D2D' }}
          />
          {absNet >= 1 && (
            <button
              onClick={() => setAmountVal(0)}
              className="px-3 py-3 rounded-2xl text-xs font-bold border"
              style={{ borderColor: '#ECE5DC', color: '#6B6459', background: '#FFFFFF' }}
            >
              Saldo
            </button>
          )}
        </div>
        {amount > 0 && (
          <p className="text-xs mb-3" style={{ color: settledExactly ? '#5BA886' : '#6B6459' }}>
            {settledExactly
              ? 'Después de esto quedan a mano. 🤝'
              : newNet > 0
                ? `Después de esto, ${partnerName} te debe ${fmt(newNet)}.`
                : `Después de esto, le debés ${fmt(-newNet)} a ${partnerName}.`}
          </p>
        )}

        {/* Real money movement — record the transfer between accounts, not just
            the couple balance. Off = cash or settled outside the app. */}
        <div className="rounded-2xl p-3 mb-3 border" style={{ background: '#FFFFFF', borderColor: '#ECE5DC' }}>
          <button
            onClick={() => setMoveMoney((v) => !v)}
            disabled={!canMoveMoney}
            className="w-full flex items-center justify-between disabled:opacity-50"
          >
            <span className="text-xs font-bold" style={{ color: '#2D2D2D' }}>
              💸 Mover plata entre cuentas
            </span>
            <span
              className="text-[11px] font-bold px-2 py-1 rounded-full"
              style={{
                background: willMoveMoney ? '#E4F2EA' : '#ECE5DC',
                color: willMoveMoney ? '#5BA886' : '#6B6459',
              }}
            >
              {willMoveMoney ? 'Sí' : 'No'}
            </span>
          </button>
          {!canMoveMoney ? (
            <p className="text-[11px] mt-2" style={{ color: '#6B6459' }}>
              Hace falta una cuenta en pesos (no tarjeta) de cada uno para registrar el movimiento.
            </p>
          ) : (
            willMoveMoney && (
              <div className="flex items-center gap-2 mt-2">
                <div className="flex-1">
                  <p className="text-[11px] font-bold mb-1" style={{ color: '#6B6459' }}>Desde · {payerName}</p>
                  <select
                    value={effectiveFromId ?? ''}
                    onChange={(e) => setFromAccountId(e.target.value || null)}
                    className="w-full px-3 py-2 rounded-xl text-xs font-bold border bg-white"
                    style={{ borderColor: '#ECE5DC', color: '#2D2D2D' }}
                  >
                    {fromAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
                <span className="text-lg mt-4" style={{ color: '#5B8DEF' }}>→</span>
                <div className="flex-1">
                  <p className="text-[11px] font-bold mb-1" style={{ color: '#6B6459' }}>Hacia · {receiverName}</p>
                  <select
                    value={effectiveToId ?? ''}
                    onChange={(e) => setToAccountId(e.target.value || null)}
                    className="w-full px-3 py-2 rounded-xl text-xs font-bold border bg-white"
                    style={{ borderColor: '#ECE5DC', color: '#2D2D2D' }}
                  >
                    {toAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            )
          )}
        </div>

        <div className="flex items-center gap-2 mb-4">
          <input
            type="text"
            placeholder="Nota (opcional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="flex-1 px-4 py-3 rounded-2xl text-sm border bg-white outline-none"
            style={{ borderColor: '#ECE5DC', color: '#2D2D2D' }}
          />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="px-3 py-3 rounded-2xl text-xs font-bold border bg-white"
            style={{ borderColor: '#ECE5DC', color: '#2D2D2D' }}
          />
        </div>

        <button
          onClick={handleSettle}
          disabled={saving || amount <= 0}
          className="w-full py-4 rounded-2xl text-lg font-black text-white disabled:opacity-40"
          style={{ background: '#FF7F6B' }}
        >
          {saving ? 'Guardando…' : settledExactly ? 'Saldar y quedar a mano' : 'Registrar pago'}
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
  const [fabType, setFabType] = useState<'expense' | 'income' | 'transfer'>('expense');
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
      const { data } = await supabase.from('categories').select('id, name, icon, kind, color').eq('household_id', profile.household_id).order('name');
      return data ?? [];
    },
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase.from('accounts').select('id, name, type, currency, owner_profile_id').eq('household_id', profile.household_id).eq('archived', false).order('name');
      return data ?? [];
    },
  });

  // Household split mode ('equal' = 50/50, 'income' = proportional to incomes).
  const { data: household } = useQuery({
    queryKey: ['household', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('households')
        .select('split_mode')
        .eq('id', profile.household_id)
        .single();
      return data;
    },
  });
  const splitMode: 'equal' | 'income' = household?.split_mode === 'income' ? 'income' : 'equal';

  const splitModeMutation = useMutation({
    mutationFn: async (mode: 'equal' | 'income') => {
      const { error } = await supabase
        .from('households')
        .update({ split_mode: mode })
        .eq('id', profile.household_id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Listo ✓');
      qc.invalidateQueries({ queryKey: ['household', profile.household_id] });
    },
    onError: () => toast.error('No se pudo guardar. Intentá de nuevo.'),
  });
  // Reflect the tapped option immediately while the update is in flight.
  const activeSplitMode = splitModeMutation.isPending ? splitModeMutation.variables : splitMode;

  // Current month combined transactions
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  // Previous closed calendar month — local date parts, never toISOString.
  const prevMonthStart = toLocalISO(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const prevMonthEnd = toLocalISO(new Date(now.getFullYear(), now.getMonth(), 0));

  // Last month's incomes, used to compute the income-proportional split.
  const { data: prevIncomes = [] } = useQuery({
    queryKey: ['prev-month-incomes', profile.household_id, prevMonthStart],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('amount, currency, usd_rate_snapshot, profile_id')
        .eq('household_id', profile.household_id)
        .eq('type', 'income')
        .gte('occurred_on', prevMonthStart)
        .lte('occurred_on', prevMonthEnd);
      return data ?? [];
    },
    enabled: activeSplitMode === 'income',
  });

  const { data: txData } = useQuery({
    queryKey: ['couple-transactions', profile.household_id, monthStart],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('amount, type, currency, scope, profile_id, category_id, is_shared, categories(name, icon)')
        .eq('household_id', profile.household_id)
        .gte('occurred_on', monthStart)
        .order('occurred_on', { ascending: false });
      return data ?? [];
    },
  });

  const allTx = txData ?? [];
  // Normalize USD→ARS so combined couple totals are in one currency.
  const toArs = (amount: number, currency?: string | null) =>
    currency === 'USD' && arsPerUsd > 0 ? Math.round(amount * arsPerUsd) : amount;
  const expenses = allTx.filter((t) => t.type === 'expense');
  const incomes = allTx.filter((t) => t.type === 'income');
  const totalExpenses = expenses.reduce((s, t) => s + toArs(t.amount, t.currency), 0);
  const totalIncome = incomes.reduce((s, t) => s + toArs(t.amount, t.currency), 0);
  const householdExpenses = expenses.filter((t) => t.scope === 'household').reduce((s, t) => s + toArs(t.amount, t.currency), 0);
  const personalExpenses = expenses.filter((t) => t.scope === 'personal').reduce((s, t) => s + toArs(t.amount, t.currency), 0);
  const sharedExpenses = expenses.filter((t) => t.is_shared).reduce((s, t) => s + toArs(t.amount, t.currency), 0);

  // Category breakdown for shared expenses
  const sharedByCategory: Record<string, { name: string; icon: string; amount: number }> = {};
  for (const t of expenses.filter((t) => t.is_shared)) {
    const cat = (t as unknown as { categories: { name: string; icon: string } | null }).categories;
    const key = t.category_id ?? 'sin-categoria';
    if (!sharedByCategory[key]) {
      sharedByCategory[key] = { name: cat?.name ?? 'Sin categoría', icon: cat?.icon ?? '🏷️', amount: 0 };
    }
    sharedByCategory[key].amount += toArs(t.amount, t.currency);
  }
  const sharedCats = Object.values(sharedByCategory).sort((a, b) => b.amount - a.amount);

  // Each person's share of last month's income, for the "Según ingresos" split.
  // USD incomes convert at their snapshot rate, falling back to the current blue.
  let myPrevIncome = 0;
  let partnerPrevIncome = 0;
  for (const t of prevIncomes) {
    const ars =
      t.currency === 'USD'
        ? Math.round(t.amount * (Number(t.usd_rate_snapshot) || arsPerUsd))
        : t.amount;
    if (t.profile_id === profile.id) myPrevIncome += ars;
    else if (partner && t.profile_id === partner.id) partnerPrevIncome += ars;
  }
  const totalPrevIncome = myPrevIncome + partnerPrevIncome;
  const myIncomePct = totalPrevIncome > 0 ? Math.round((myPrevIncome / totalPrevIncome) * 100) : 50;
  const partnerIncomePct = 100 - myIncomePct;

  const absNet = Math.abs(net);
  // Splits are rounded ARS, so treat sub-peso residue as settled.
  const balanced = absNet < 1;
  const partnerOwesMe = !balanced && net > 0;
  const iOwePartner = !balanced && net < 0;

  const f = (n: number) =>
    showUSD && arsPerUsd > 0
      ? `US$${Math.round(n / arsPerUsd).toLocaleString('es-AR')}`
      : formatARS(n);

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F9F5F0' }}>
      <header className="flex items-center gap-3 px-5 pt-14 pb-4">
        <Link href="/mas" style={{ color: '#6B6459', fontSize: 22 }}>←</Link>
        <div className="flex-1">
          <h1 className="text-2xl font-black" style={{ color: '#2D2D2D' }}>Vista de pareja</h1>
          {partner && <p className="text-xs" style={{ color: '#6B6459' }}>{myName} & {partner.name}</p>}
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
        <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: '#6B6459' }}>
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
            <p className="text-xs" style={{ color: '#6B6459' }}>🏠 Hogar</p>
            <p className="text-xs font-bold" style={{ color: '#2D2D2D' }}>{f(householdExpenses)}</p>
          </div>
          <div className="flex justify-between">
            <p className="text-xs" style={{ color: '#6B6459' }}>👤 Personal</p>
            <p className="text-xs font-bold" style={{ color: '#2D2D2D' }}>{f(personalExpenses)}</p>
          </div>
        </div>
      </div>

      {/* Who owes whom */}
      {!partner ? (
        <div className="mx-4 rounded-3xl p-5 mb-4 text-center" style={{ background: '#FFFFFF' }}>
          <p className="text-3xl mb-2">👫</p>
          <p className="text-sm font-bold" style={{ color: '#2D2D2D' }}>Todavía no hay pareja vinculada al hogar</p>
          <p className="text-sm mt-1 mb-4" style={{ color: '#6B6459' }}>
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
          <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: '#6B6459' }}>
            Quién le debe a quién
          </p>

          {balanceLoading ? (
            <p className="text-sm" style={{ color: '#6B6459' }}>Calculando…</p>
          ) : balanced ? (
            <div className="text-center py-2">
              <p className="text-3xl mb-1">🤝</p>
              <p className="text-base font-black" style={{ color: '#2D2D2D' }}>¡Estamos al día!</p>
              <p className="text-xs mt-1" style={{ color: '#6B6459' }}>No hay deudas pendientes entre ustedes.</p>
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

      {/* Default split for new household expenses */}
      {partner && (
        <div className="mx-4 rounded-3xl p-5 mb-4 shadow-sm" style={{ background: '#FFFFFF' }}>
          <p className="text-sm font-bold mb-3" style={{ color: '#2D2D2D' }}>
            ⚖️ ¿Cómo dividen los gastos del hogar?
          </p>
          <div className="flex rounded-2xl overflow-hidden p-1 gap-1 mb-3" style={{ background: '#ECE5DC' }}>
            {([
              { key: 'equal', label: '50/50' },
              { key: 'income', label: 'Según ingresos' },
            ] as const).map((o) => {
              const active = activeSplitMode === o.key;
              return (
                <button
                  key={o.key}
                  onClick={() => {
                    if (!active && !splitModeMutation.isPending) splitModeMutation.mutate(o.key);
                  }}
                  className="flex-1 py-2 text-xs font-bold rounded-xl transition-colors"
                  style={{ background: active ? '#FFFFFF' : 'transparent', color: active ? '#2D2D2D' : '#6B6459' }}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
          {activeSplitMode === 'income' &&
            (totalPrevIncome > 0 ? (
              <p className="text-xs font-bold mb-2" style={{ color: '#2D2D2D' }}>
                Este mes: {myName} {myIncomePct}% · {partner.name} {partnerIncomePct}%
              </p>
            ) : (
              <p className="text-xs mb-2" style={{ color: '#6B6459', opacity: 0.7 }}>
                Sin ingresos el mes pasado — se usa 50/50
              </p>
            ))}
          <p className="text-[11px]" style={{ color: '#6B6459' }}>
            Se aplica como división sugerida en los nuevos gastos del hogar y en los gastos fijos.
          </p>
        </div>
      )}

      {/* Shared category breakdown */}
      {sharedCats.length > 0 && (
        <div className="mx-4 rounded-3xl p-5 mb-4 shadow-sm" style={{ background: '#FFFFFF' }}>
          <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: '#6B6459' }}>
            Gastos compartidos por categoría
          </p>
          <div className="flex flex-col gap-2">
            {sharedCats.map((cat) => {
              const pct = sharedExpenses > 0 ? cat.amount / sharedExpenses : 0;
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
          <p className="text-xs mt-3" style={{ color: '#6B6459' }}>
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
          accounts={accounts}
          fmt={f}
        />
      )}

      <InvitePartnerModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  );
}
