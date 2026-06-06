'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { formatARS, formatUSD, parseMoney } from '@/lib/format';
import { MoneyInput } from '@/components/MoneyInput';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SecondaryButton } from '@/components/SecondaryButton';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { BottomNav } from '@/components/BottomNav';
import { AddTransactionSheet } from '@/components/AddTransactionSheet';
import { toast } from 'sonner';
import Link from 'next/link';
import { EmptyState } from '@/components/EmptyState';

interface Profile {
  id: string;
  household_id: string;
  nickname: string | null;
  display_name: string | null;
}

interface Debt {
  id: string;
  counterparty: string;
  direction: 'owe' | 'owed';
  amount: number;
  currency: 'ARS' | 'USD';
  note: string | null;
  settled: boolean;
  transaction_id: string | null;
}

interface LinkableExpense { id: string; label: string; occurred_on: string; }

function fmtMoney(amount: number, currency: string): string {
  return currency === 'USD' ? formatUSD(amount) : formatARS(amount);
}

// Sum unsettled debts of a direction, split by currency.
function totalsByCurrency(debts: Debt[], direction: 'owe' | 'owed') {
  const rows = debts.filter((d) => !d.settled && d.direction === direction);
  const usd = rows.filter((d) => d.currency === 'USD').reduce((s, d) => s + d.amount, 0);
  const ars = rows.filter((d) => d.currency === 'ARS').reduce((s, d) => s + d.amount, 0);
  return { usd, ars };
}

function DebtForm({
  initial,
  expenses,
  onSave,
  onCancel,
}: {
  initial?: Partial<Debt>;
  expenses: LinkableExpense[];
  onSave: (data: Omit<Debt, 'id'>) => void;
  onCancel: () => void;
}) {
  const [direction, setDirection] = useState<'owe' | 'owed'>(initial?.direction ?? 'owe');
  const [counterparty, setCounterparty] = useState(initial?.counterparty ?? '');
  const [amountStr, setAmountStr] = useState(initial?.amount ? String(initial.amount) : '');
  const [currency, setCurrency] = useState<'ARS' | 'USD'>(initial?.currency ?? 'USD');
  const [note, setNote] = useState(initial?.note ?? '');
  const [settled, setSettled] = useState(initial?.settled ?? false);
  const [transactionId, setTransactionId] = useState<string>(initial?.transaction_id ?? '');

  function handleSave() {
    const amount = parseMoney(amountStr);
    if (!counterparty.trim() || !amount || amount <= 0) {
      toast.error('Completá la persona y el monto.');
      return;
    }
    onSave({ direction, counterparty: counterparty.trim(), amount, currency, note: note.trim() || null, settled, transaction_id: transactionId || null });
  }

  return (
    <div className="flex flex-col gap-4 p-5 rounded-3xl" style={{ background: '#FFFFFF' }}>
      {/* Direction */}
      <div className="flex rounded-2xl overflow-hidden" style={{ background: '#ECE5DC' }}>
        {(['owe', 'owed'] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDirection(d)}
            className="flex-1 py-2.5 text-sm font-bold transition-colors"
            style={{
              background: direction === d ? (d === 'owe' ? '#FF7F6B' : '#7EC8A4') : 'transparent',
              color: direction === d ? '#FFFFFF' : '#6B6459',
              borderRadius: '14px',
            }}
          >
            {d === 'owe' ? 'Yo debo' : 'Me deben'}
          </button>
        ))}
      </div>

      {/* Counterparty */}
      <input
        type="text"
        placeholder={direction === 'owe' ? '¿A quién le debés? (ej: Franco)' : '¿Quién te debe?'}
        value={counterparty}
        onChange={(e) => setCounterparty(e.target.value)}
        className="w-full px-4 py-3 rounded-2xl text-sm border outline-none"
        style={{ borderColor: '#ECE5DC', color: '#2D2D2D' }}
      />

      {/* Currency */}
      <div>
        <p className="text-xs font-semibold mb-2" style={{ color: '#6B6459' }}>Moneda</p>
        <div className="flex rounded-2xl overflow-hidden" style={{ background: '#ECE5DC' }}>
          {(['ARS', 'USD'] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCurrency(c)}
              className="flex-1 py-2.5 text-sm font-bold transition-colors"
              style={{
                background: currency === c ? '#7EC8A4' : 'transparent',
                color: currency === c ? '#FFFFFF' : '#6B6459',
                borderRadius: '14px',
              }}
            >
              {c === 'ARS' ? 'ARS (Pesos)' : 'USD (Dólares)'}
            </button>
          ))}
        </div>
      </div>

      {/* Amount */}
      <MoneyInput
        placeholder={`Monto en ${currency}`}
        value={parseMoney(amountStr)}
        onChange={(n) => setAmountStr(n ? String(n) : '')}
        className="w-full px-4 py-3 rounded-2xl text-sm border outline-none"
        style={{ borderColor: '#ECE5DC', color: '#2D2D2D' }}
      />

      {/* Note */}
      <input
        type="text"
        placeholder="Nota (opcional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="w-full px-4 py-3 rounded-2xl text-sm border outline-none"
        style={{ borderColor: '#ECE5DC', color: '#2D2D2D' }}
      />

      {/* Link to an expense — only when someone repays you, so analytics can
          net what they return out of that gasto's real cost. */}
      {direction === 'owed' && expenses.length > 0 && (
        <div>
          <p className="text-xs font-semibold mb-2" style={{ color: '#6B6459' }}>
            ¿Es la devolución de un gasto tuyo? (opcional)
          </p>
          <select
            value={transactionId}
            onChange={(e) => setTransactionId(e.target.value)}
            className="w-full px-4 py-3 rounded-2xl text-sm border outline-none"
            style={{ borderColor: transactionId ? '#7EC8A4' : '#ECE5DC', color: '#2D2D2D', background: '#FFFFFF' }}
          >
            <option value="">Sin vincular</option>
            {expenses.map((e) => (
              <option key={e.id} value={e.id}>{e.label}</option>
            ))}
          </select>
          {transactionId && (
            <p className="text-[11px] mt-1.5" style={{ color: '#5BA886' }}>
              ✓ El análisis va a descontar este monto de ese gasto.
            </p>
          )}
        </div>
      )}

      {/* Settled toggle */}
      <button
        type="button"
        onClick={() => setSettled((v) => !v)}
        className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border w-fit"
        style={{
          background: settled ? '#E4F2EA' : '#FFFFFF',
          borderColor: settled ? '#7EC8A4' : '#ECE5DC',
          color: settled ? '#5BA886' : '#6B6459',
        }}
      >
        {settled ? '✓ Saldada' : 'Pendiente'}
      </button>

      <div className="flex gap-3">
        <SecondaryButton onClick={onCancel} className="flex-1 py-3 text-sm">
          Cancelar
        </SecondaryButton>
        <PrimaryButton
          onClick={handleSave}
          disabled={!counterparty.trim() || !(parseMoney(amountStr) > 0)}
          className="flex-1 py-3 text-sm"
        >
          Guardar
        </PrimaryButton>
      </div>
    </div>
  );
}

function TotalsCard({ debts }: { debts: Debt[] }) {
  const owe = totalsByCurrency(debts, 'owe');
  const owed = totalsByCurrency(debts, 'owed');
  const hasOwe = owe.usd > 0 || owe.ars > 0;
  const hasOwed = owed.usd > 0 || owed.ars > 0;
  if (!hasOwe && !hasOwed) return null;

  function amounts(t: { usd: number; ars: number }) {
    const parts = [t.usd ? formatUSD(t.usd) : null, t.ars ? formatARS(t.ars) : null].filter(Boolean);
    return parts.length ? parts.join(' + ') : '—';
  }

  return (
    <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
      <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: '#6B6459' }}>
        Pendiente
      </p>
      <div className="flex gap-3">
        <div className="flex-1 rounded-2xl px-3 py-3" style={{ background: '#FFE7E2' }}>
          <p className="text-[11px] font-semibold" style={{ color: '#E5604C' }}>Yo debo</p>
          <p className="text-lg font-black leading-tight" style={{ color: '#E5604C', fontVariantNumeric: 'tabular-nums' }}>
            {amounts(owe)}
          </p>
        </div>
        <div className="flex-1 rounded-2xl px-3 py-3" style={{ background: '#E4F2EA' }}>
          <p className="text-[11px] font-semibold" style={{ color: '#5BA886' }}>Me deben</p>
          <p className="text-lg font-black leading-tight" style={{ color: '#5BA886', fontVariantNumeric: 'tabular-nums' }}>
            {amounts(owed)}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function DeudasClient({ profile }: { profile: Profile }) {
  const supabase = createClient();
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fabType, setFabType] = useState<'expense' | 'income'>('expense');
  const [showForm, setShowForm] = useState(false);
  const [editDebt, setEditDebt] = useState<Debt | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Debt | null>(null);

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

  const { data: debts = [], isLoading } = useQuery({
    queryKey: ['debts', profile.household_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('debts')
        .select('id, counterparty, direction, amount, currency, note, settled, transaction_id')
        .eq('household_id', profile.household_id)
        .order('settled')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Debt[];
    },
  });

  // Recent expenses a "me deben" debt can be linked to (so analytics net the
  // repayment out of that gasto's real cost).
  const { data: linkableExpenses = [] } = useQuery<LinkableExpense[]>({
    queryKey: ['linkable-expenses', profile.household_id],
    queryFn: async () => {
      const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      const { data } = await supabase
        .from('transactions')
        .select('id, merchant, amount, currency, occurred_on, categories(name)')
        .eq('household_id', profile.household_id)
        .eq('type', 'expense')
        .gte('occurred_on', since)
        .order('occurred_on', { ascending: false })
        .limit(60);
      return ((data ?? []) as { id: string; merchant: string | null; amount: number; currency: string; occurred_on: string; categories: { name: string } | null }[])
        .map((t) => ({
          id: t.id,
          occurred_on: t.occurred_on,
          label: `${t.occurred_on.slice(5)} · ${t.merchant || t.categories?.name || 'Gasto'} · ${t.currency === 'USD' ? formatUSD(t.amount) : formatARS(t.amount)}`,
        }));
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['debts'] });

  const createMutation = useMutation({
    mutationFn: async (data: Omit<Debt, 'id'>) => {
      const { error } = await supabase.from('debts').insert({
        ...data,
        household_id: profile.household_id,
        profile_id: profile.id,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Deuda guardada ✓'); setShowForm(false); invalidate(); },
    onError: () => toast.error('No se pudo guardar la deuda.'),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Omit<Debt, 'id'> }) => {
      const { error } = await supabase.from('debts').update(data).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Deuda actualizada ✓'); setEditDebt(null); invalidate(); },
    onError: () => toast.error('No se pudo actualizar la deuda.'),
  });

  const toggleSettled = useMutation({
    mutationFn: async (d: Debt) => {
      const { error } = await supabase.from('debts').update({ settled: !d.settled }).eq('id', d.id);
      if (error) throw error;
    },
    onSuccess: (_data, d) => { toast.success(d.settled ? 'Marcada como pendiente' : 'Saldada ✓'); invalidate(); },
    onError: () => toast.error('No se pudo actualizar.'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('debts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Deuda eliminada'); invalidate(); },
    onError: () => toast.error('No se pudo eliminar la deuda.'),
  });

  const pending = debts.filter((d) => !d.settled);
  const settled = debts.filter((d) => d.settled);

  function DebtCard({ debt }: { debt: Debt }) {
    return (
      <div className="flex items-center gap-3 px-5 py-4" style={{ borderTop: '1px solid #ECE5DC' }}>
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-lg flex-shrink-0"
          style={{ background: debt.direction === 'owe' ? '#FFE7E2' : '#E4F2EA', opacity: debt.settled ? 0.5 : 1 }}
        >
          {debt.direction === 'owe' ? '💸' : '🤝'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm truncate" style={{ color: '#2D2D2D' }}>
            {debt.direction === 'owe' ? `Le debo a ${debt.counterparty}` : `${debt.counterparty} me debe`}
          </p>
          <p className="text-xs" style={{ color: '#6B6459' }}>
            {debt.settled ? 'Saldada' : 'Pendiente'}{debt.note ? ` · ${debt.note}` : ''}{debt.transaction_id ? ' · 🔗 gasto' : ''}
          </p>
        </div>
        <p
          className="font-black text-sm flex-shrink-0"
          style={{ color: debt.direction === 'owe' ? '#FF7F6B' : '#7EC8A4', opacity: debt.settled ? 0.5 : 1 }}
        >
          {fmtMoney(debt.amount, debt.currency)}
        </p>
        <div className="flex gap-1 ml-2 flex-shrink-0">
          <button
            onClick={() => toggleSettled.mutate(debt)}
            className="text-xs px-2 py-1 rounded-lg border"
            style={{ borderColor: '#ECE5DC', color: '#6B6459' }}
            title={debt.settled ? 'Marcar pendiente' : 'Marcar saldada'}
          >
            {debt.settled ? '↩️' : '✓'}
          </button>
          <button
            onClick={() => setEditDebt(debt)}
            className="text-xs px-2 py-1 rounded-lg border"
            style={{ borderColor: '#ECE5DC', color: '#6B6459' }}
          >
            ✏️
          </button>
          <button
            onClick={() => setConfirmDelete(debt)}
            className="text-xs px-2 py-1 rounded-lg border"
            style={{ borderColor: '#FFE7E2', color: '#FF7F6B' }}
          >
            🗑
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F9F5F0' }}>
      <header className="px-5 pt-14 pb-4 flex items-center gap-3">
        <Link href="/mas" className="text-2xl">←</Link>
        <h1 className="text-2xl font-black" style={{ color: '#2D2D2D' }}>Deudas</h1>
      </header>

      <div className="px-4 flex flex-col gap-4">
        {!showForm && !editDebt && debts.length > 0 && <TotalsCard debts={debts} />}

        {showForm && !editDebt && (
          <DebtForm
            expenses={linkableExpenses}
            onSave={(data) => createMutation.mutate(data)}
            onCancel={() => setShowForm(false)}
          />
        )}

        {editDebt && (
          <DebtForm
            initial={editDebt}
            expenses={linkableExpenses}
            onSave={(data) => updateMutation.mutate({ id: editDebt.id, data })}
            onCancel={() => setEditDebt(null)}
          />
        )}

        {!showForm && !editDebt && (
          <button
            onClick={() => setShowForm(true)}
            className="w-full py-4 rounded-3xl text-sm font-bold text-white"
            style={{ background: '#7EC8A4' }}
          >
            + Nueva deuda
          </button>
        )}

        {pending.length > 0 && (
          <div className="rounded-3xl overflow-hidden" style={{ background: '#FFFFFF' }}>
            <div className="px-5 py-3" style={{ borderBottom: '1px solid #ECE5DC' }}>
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#FF7F6B' }}>
                Pendientes
              </p>
            </div>
            {pending.map((d) => <DebtCard key={d.id} debt={d} />)}
          </div>
        )}

        {settled.length > 0 && (
          <div className="rounded-3xl overflow-hidden" style={{ background: '#FFFFFF' }}>
            <div className="px-5 py-3" style={{ borderBottom: '1px solid #ECE5DC' }}>
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#5BA886' }}>
                Saldadas
              </p>
            </div>
            {settled.map((d) => <DebtCard key={d.id} debt={d} />)}
          </div>
        )}

        {!isLoading && debts.length === 0 && !showForm && (
          <EmptyState
            icon="🤝"
            title="Sin deudas"
            subtitle="Registrá lo que debés o lo que te deben."
          />
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete !== null}
        title="¿Eliminar deuda?"
        message={confirmDelete ? `Se eliminará la deuda con ${confirmDelete.counterparty}. Esta acción no se puede deshacer.` : undefined}
        confirmLabel="Eliminar"
        onConfirm={() => {
          if (confirmDelete) deleteMutation.mutate(confirmDelete.id);
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />

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
