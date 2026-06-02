'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { BottomNav } from '@/components/BottomNav';
import { AddTransactionSheet } from '@/components/AddTransactionSheet';
import { toast } from 'sonner';
import { EmptyState } from '@/components/EmptyState';
import { formatARS } from '@/lib/format';
import { todayISO } from '@/lib/date';

const ACCOUNT_TYPES = [
  { value: 'checking', label: 'Cuenta corriente' },
  { value: 'savings', label: 'Caja de ahorro' },
  { value: 'cash', label: 'Efectivo' },
  { value: 'credit', label: 'Tarjeta de crédito' },
];

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
  const [saving, setSaving] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fabType, setFabType] = useState<'expense' | 'income'>('expense');

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
      const { data } = await supabase
        .from('accounts')
        .select('id, name, type, currency, archived, owner_profile_id, initial_balance')
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
    setShowForm(true);
  }

  function openEdit(a: (typeof accounts)[0]) {
    setEditId(a.id);
    setName(a.name);
    setType(a.type);
    setCurrency(a.currency);
    setInitialBalance(a.initial_balance ? String(a.initial_balance) : '');
    setShowForm(true);
  }

  async function handleSave() {
    if (!name.trim()) { toast.error('Ingresá un nombre.'); return; }
    setSaving(true);
    try {
      const initialBalanceNum = parseInt(initialBalance.replace(/\D/g, ''), 10) || 0;
      if (editId) {
        const { error } = await supabase
          .from('accounts')
          .update({ name: name.trim(), type, currency, initial_balance: initialBalanceNum })
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
        });
        if (error) throw error;
      }
      await qc.invalidateQueries({ queryKey: ['accounts'] });
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
            <div>
              <input
                type="number"
                inputMode="numeric"
                placeholder={type === 'credit' ? 'Deuda inicial (opcional)' : 'Saldo inicial (opcional)'}
                value={initialBalance}
                onChange={(e) => setInitialBalance(e.target.value)}
                className="w-full px-4 py-3 rounded-2xl border text-sm outline-none"
                style={{ borderColor: '#ECE5DC' }}
              />
              <p className="text-xs mt-1.5 px-1" style={{ color: '#8A8276' }}>
                {type === 'credit'
                  ? 'Mostramos cuánto llevás gastado este mes según tus movimientos.'
                  : 'El saldo se actualiza solo con tus ingresos y gastos.'}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 py-3 rounded-2xl border text-sm font-bold"
                style={{ borderColor: '#ECE5DC', color: '#8A8276' }}
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-3 rounded-2xl text-sm font-bold text-white disabled:opacity-40"
                style={{ background: '#7EC8A4' }}
              >
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
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
              <p className="text-xs" style={{ color: '#8A8276' }}>
                {ACCOUNT_TYPES.find((t) => t.value === a.type)?.label} · {a.currency}
                {a.archived && ' · Archivada'}
              </p>
              {a.type === 'credit' ? (
                <p className="text-sm font-black mt-1" style={{ color: '#FF7F6B' }}>
                  {formatARS(cardMonthSpend(a.id))}
                  <span className="text-xs font-semibold" style={{ color: '#8A8276' }}> gastado este mes</span>
                </p>
              ) : (
                (() => {
                  const bal = assetBalance(a.id, a.initial_balance ?? 0);
                  return (
                    <p className="text-sm font-black mt-1" style={{ color: bal < 0 ? '#FF7F6B' : '#5BA886' }}>
                      {formatARS(bal)}
                      <span className="text-xs font-semibold" style={{ color: '#8A8276' }}> saldo actual</span>
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
                  style={{ borderColor: '#ECE5DC', color: '#8A8276' }}
                >
                  Editar
                </button>
              )}
              <button
                onClick={() => handleArchive(a.id, a.archived)}
                className="text-xs font-bold px-3 py-1.5 rounded-xl border"
                style={{ borderColor: '#ECE5DC', color: '#8A8276' }}
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
