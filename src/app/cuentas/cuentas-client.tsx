'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { BottomNav } from '@/components/BottomNav';
import { AddTransactionSheet } from '@/components/AddTransactionSheet';
import { toast } from 'sonner';
import { EmptyState } from '@/components/EmptyState';
import { formatARS, formatUSD } from '@/lib/format';
import { todayISO } from '@/lib/date';
import { MoneyInput } from '@/components/MoneyInput';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SecondaryButton } from '@/components/SecondaryButton';

const ACCOUNT_TYPES = [
  { value: 'checking', label: 'Cuenta corriente' },
  { value: 'savings', label: 'Caja de ahorro' },
  { value: 'cash', label: 'Efectivo' },
  { value: 'credit', label: 'Tarjeta de crédito' },
];

// Whole days from today to an ISO date (negative = already past).
function daysUntil(dateISO: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateISO + 'T00:00:00');
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

function dueLabel(dueISO: string): string {
  const d = daysUntil(dueISO);
  if (d < 0) return `Vencido hace ${Math.abs(d)} día${Math.abs(d) === 1 ? '' : 's'}`;
  if (d === 0) return 'Vence hoy';
  if (d === 1) return 'Vence mañana';
  return `Vence en ${d} días`;
}

interface Profile {
  id: string;
  household_id: string;
  nickname: string | null;
  display_name: string | null;
}

export default function CuentasClient({ profile }: { profile: Profile }) {
  const supabase = createClient();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState('checking');
  const [currency, setCurrency] = useState('ARS');
  const [initialBalance, setInitialBalance] = useState('');
  // Credit-card statement fields (only used when type === 'credit').
  const [statementArs, setStatementArs] = useState('');
  const [statementUsd, setStatementUsd] = useState('');
  const [closingDate, setClosingDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fabType, setFabType] = useState<'expense' | 'income'>('expense');

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase.from('categories').select('id, name, icon, kind, color').eq('household_id', profile.household_id).order('name');
      return data ?? [];
    },
  });

  const { data: accounts = [] } = useQuery({
    // Distinct key (…'detail') so it doesn't collide with the lightweight
    // ['accounts', household] query used elsewhere (id/name/type only),
    // which would otherwise overwrite the cache and drop initial_balance.
    // Still invalidated by invalidateQueries(['accounts']) via prefix match.
    queryKey: ['accounts', profile.household_id, 'detail'],
    queryFn: async () => {
      const { data } = await supabase
        .from('accounts')
        .select('id, name, type, currency, archived, owner_profile_id, initial_balance, statement_ars, statement_usd, closing_date, due_date')
        .eq('household_id', profile.household_id)
        .order('name');
      return data ?? [];
    },
  });

  // All transactions with an account, to compute live balances / card spend.
  const { data: accountTx = [] } = useQuery({
    queryKey: ['account-tx', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('account_id, type, amount, occurred_on')
        .eq('household_id', profile.household_id)
        .not('account_id', 'is', null);
      return data ?? [];
    },
  });

  const todayStr = todayISO();
  const monthStart = todayStr.slice(0, 7) + '-01';

  // Asset accounts: saldo = inicial + ingresos - gastos (hasta hoy).
  // Tarjetas: gastado en el mes actual.
  function assetBalance(accountId: string, initial: number) {
    return accountTx
      .filter((t) => t.account_id === accountId && t.occurred_on <= todayStr)
      .reduce((s, t) => s + (t.type === 'income' ? t.amount : t.type === 'expense' ? -t.amount : 0), initial);
  }
  function cardMonthSpend(accountId: string) {
    return accountTx
      .filter((t) => t.account_id === accountId && t.type === 'expense' && t.occurred_on >= monthStart && t.occurred_on <= todayStr)
      .reduce((s, t) => s + t.amount, 0);
  }

  function openNew() {
    setEditId(null);
    setName('');
    setType('checking');
    setCurrency('ARS');
    setInitialBalance('');
    setStatementArs('');
    setStatementUsd('');
    setClosingDate('');
    setDueDate('');
    setShowForm(true);
  }

  function openEdit(a: (typeof accounts)[0]) {
    setEditId(a.id);
    setName(a.name);
    setType(a.type);
    setCurrency(a.currency);
    setInitialBalance(a.initial_balance ? String(a.initial_balance) : '');
    setStatementArs(a.statement_ars ? String(a.statement_ars) : '');
    setStatementUsd(a.statement_usd ? String(a.statement_usd) : '');
    setClosingDate(a.closing_date ?? '');
    setDueDate(a.due_date ?? '');
    setShowForm(true);
  }

  async function handleSave() {
    if (!name.trim()) { toast.error('Ingresá un nombre.'); return; }
    setSaving(true);
    try {
      const initialBalanceNum = parseInt(initialBalance.replace(/\D/g, ''), 10) || 0;
      // Statement fields only apply to credit cards; clear them otherwise.
      const isCredit = type === 'credit';
      const cardFields = {
        statement_ars: isCredit ? parseInt(statementArs.replace(/\D/g, ''), 10) || null : null,
        statement_usd: isCredit ? parseInt(statementUsd.replace(/\D/g, ''), 10) || null : null,
        closing_date: isCredit && closingDate ? closingDate : null,
        due_date: isCredit && dueDate ? dueDate : null,
      };
      if (editId) {
        const { error } = await supabase
          .from('accounts')
          .update({ name: name.trim(), type, currency, initial_balance: initialBalanceNum, ...cardFields })
          .eq('id', editId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('accounts').insert({
          household_id: profile.household_id,
          owner_profile_id: profile.id,
          name: name.trim(),
          type,
          currency,
          initial_balance: initialBalanceNum,
          archived: false,
          ...cardFields,
        });
        if (error) throw error;
      }
      await qc.invalidateQueries({ queryKey: ['accounts'] });
      await qc.invalidateQueries({ queryKey: ['accounts-full'] });
      toast.success(editId ? 'Cuenta actualizada ✓' : 'Cuenta creada ✓');
      setShowForm(false);
    } catch (e) {
      toast.error('No se pudo guardar.');
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive(id: string, archived: boolean) {
    const { error } = await supabase.from('accounts').update({ archived: !archived }).eq('id', id);
    if (error) { toast.error('Error al actualizar.'); return; }
    await qc.invalidateQueries({ queryKey: ['accounts'] });
    await qc.invalidateQueries({ queryKey: ['accounts-full'] });
    toast.success(!archived ? 'Cuenta archivada' : 'Cuenta restaurada');
  }

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F9F5F0' }}>
      <header className="px-5 pt-14 pb-4 flex items-center justify-between">
        <h1 className="text-2xl font-black" style={{ color: '#2D2D2D' }}>Cuentas</h1>
        <button
          onClick={openNew}
          className="text-sm font-bold px-4 py-2 rounded-2xl text-white"
          style={{ background: '#7EC8A4' }}
        >
          + Nueva
        </button>
      </header>

      {showForm && (
        <div className="mx-4 mb-4 rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
          <p className="text-base font-black mb-4" style={{ color: '#2D2D2D' }}>
            {editId ? 'Editar cuenta' : 'Nueva cuenta'}
          </p>
          <div className="flex flex-col gap-3">
            <input
              type="text"
              placeholder="Nombre (ej: Cuenta Galicia)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="px-4 py-3 rounded-2xl border text-sm outline-none"
              style={{ borderColor: '#ECE5DC' }}
            />
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="px-4 py-3 rounded-2xl border text-sm bg-white"
              style={{ borderColor: '#ECE5DC' }}
            >
              {ACCOUNT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="px-4 py-3 rounded-2xl border text-sm bg-white"
              style={{ borderColor: '#ECE5DC' }}
            >
              <option value="ARS">ARS (Pesos)</option>
              <option value="USD">USD (Dólares)</option>
            </select>
            {type === 'credit' ? (
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-xs font-semibold mb-1.5 px-1" style={{ color: '#6B6459' }}>Total del resumen</p>
                  <div className="flex gap-2">
                    <MoneyInput
                      placeholder="Total ARS"
                      value={statementArs ? parseInt(statementArs.replace(/\D/g, ''), 10) || 0 : 0}
                      onChange={(n) => setStatementArs(n ? String(n) : '')}
                      className="flex-1 w-full px-4 py-3 rounded-2xl border text-sm outline-none"
                      style={{ borderColor: '#ECE5DC' }}
                    />
                    <MoneyInput
                      placeholder="Total USD"
                      value={statementUsd ? parseInt(statementUsd.replace(/\D/g, ''), 10) || 0 : 0}
                      onChange={(n) => setStatementUsd(n ? String(n) : '')}
                      className="flex-1 w-full px-4 py-3 rounded-2xl border text-sm outline-none"
                      style={{ borderColor: '#ECE5DC' }}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <label className="flex-1">
                    <span className="text-xs font-semibold mb-1 px-1 block" style={{ color: '#6B6459' }}>Cierre</span>
                    <input
                      type="date"
                      value={closingDate}
                      onChange={(e) => setClosingDate(e.target.value)}
                      className="w-full px-3 py-3 rounded-2xl border text-sm outline-none bg-white"
                      style={{ borderColor: '#ECE5DC' }}
                    />
                  </label>
                  <label className="flex-1">
                    <span className="text-xs font-semibold mb-1 px-1 block" style={{ color: '#6B6459' }}>Vencimiento</span>
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="w-full px-3 py-3 rounded-2xl border text-sm outline-none bg-white"
                      style={{ borderColor: '#ECE5DC' }}
                    />
                  </label>
                </div>
                <p className="text-xs px-1" style={{ color: '#6B6459' }}>
                  Guardamos el total y las fechas del resumen actual. Editá la tarjeta cada mes al nuevo cierre.
                </p>
              </div>
            ) : (
              <div>
                <MoneyInput
                  placeholder="Saldo inicial (opcional)"
                  value={initialBalance ? parseInt(initialBalance.replace(/\D/g, ''), 10) || 0 : 0}
                  onChange={(n) => setInitialBalance(n ? String(n) : '')}
                  className="w-full px-4 py-3 rounded-2xl border text-sm outline-none"
                  style={{ borderColor: '#ECE5DC' }}
                />
                <p className="text-xs mt-1.5 px-1" style={{ color: '#6B6459' }}>
                  El saldo se actualiza solo con tus ingresos y gastos.
                </p>
              </div>
            )}
            <div className="flex gap-2">
              <SecondaryButton onClick={() => setShowForm(false)} className="flex-1 py-3 text-sm">
                Cancelar
              </SecondaryButton>
              <PrimaryButton
                onClick={handleSave}
                disabled={!name.trim()}
                loading={saving}
                className="flex-1 py-3 text-sm"
              >
                {saving ? 'Guardando…' : 'Guardar'}
              </PrimaryButton>
            </div>
          </div>
        </div>
      )}

      <div className="px-4 flex flex-col gap-3">
        {accounts.length === 0 && !showForm && (
          <EmptyState
            icon="🏦"
            title="Sin cuentas"
            subtitle="Agregá una cuenta para empezar."
            action={{ label: '+ Nueva cuenta', onClick: openNew }}
          />
        )}
        {accounts.map((a) => (
          <div
            key={a.id}
            className="rounded-3xl px-5 py-4 flex items-center gap-3"
            style={{ background: '#FFFFFF', opacity: a.archived ? 0.5 : 1 }}
          >
            <span className="text-2xl">{a.type === 'cash' ? '💵' : a.type === 'credit' ? '💳' : '🏦'}</span>
            <div className="flex-1 min-w-0">
              <p className="font-bold" style={{ color: '#2D2D2D' }}>{a.name}</p>
              <p className="text-xs" style={{ color: '#6B6459' }}>
                {ACCOUNT_TYPES.find((t) => t.value === a.type)?.label} · {a.currency}
                {a.archived && ' · Archivada'}
              </p>
              {a.type === 'credit' ? (
                <div className="mt-1">
                  {(a.statement_ars || a.statement_usd) ? (
                    <p className="text-sm font-black" style={{ color: '#FF7F6B' }}>
                      {[
                        a.statement_ars ? formatARS(a.statement_ars) : null,
                        a.statement_usd ? formatUSD(a.statement_usd) : null,
                      ].filter(Boolean).join(' + ')}
                      <span className="text-xs font-semibold" style={{ color: '#6B6459' }}> resumen</span>
                    </p>
                  ) : (
                    <p className="text-sm font-black" style={{ color: '#FF7F6B' }}>
                      {formatARS(cardMonthSpend(a.id))}
                      <span className="text-xs font-semibold" style={{ color: '#6B6459' }}> gastado este mes</span>
                    </p>
                  )}
                  {a.due_date && (
                    <p className="text-xs font-bold mt-0.5" style={{ color: daysUntil(a.due_date) < 0 ? '#E5604C' : '#6B6459' }}>
                      {dueLabel(a.due_date)}
                      {a.closing_date ? ` · cierre ${a.closing_date.slice(8, 10)}/${a.closing_date.slice(5, 7)}` : ''}
                    </p>
                  )}
                </div>
              ) : (
                (() => {
                  const bal = assetBalance(a.id, a.initial_balance ?? 0);
                  return (
                    <p className="text-sm font-black mt-1" style={{ color: bal < 0 ? '#FF7F6B' : '#5BA886' }}>
                      {formatARS(bal)}
                      <span className="text-xs font-semibold" style={{ color: '#6B6459' }}> saldo actual</span>
                    </p>
                  );
                })()
              )}
            </div>
            <div className="flex gap-2 flex-shrink-0">
              {!a.archived && (
                <button
                  onClick={() => openEdit(a)}
                  className="text-xs font-bold px-3 py-1.5 rounded-xl border"
                  style={{ borderColor: '#ECE5DC', color: '#6B6459' }}
                >
                  Editar
                </button>
              )}
              <button
                onClick={() => handleArchive(a.id, a.archived)}
                className="text-xs font-bold px-3 py-1.5 rounded-xl border"
                style={{ borderColor: '#ECE5DC', color: '#6B6459' }}
              >
                {a.archived ? 'Restaurar' : 'Archivar'}
              </button>
            </div>
          </div>
        ))}
      </div>

      <BottomNav onFab={(type) => { setFabType(type); setSheetOpen(true); }} />
      <AddTransactionSheet
        open={sheetOpen}
        initialType={fabType}
        onClose={() => setSheetOpen(false)}
        householdId={profile.household_id}
        profileId={profile.id}
        categories={categories}
        accounts={accounts.filter((a) => !a.archived)}
      />
    </div>
  );
}
