'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { BottomNav } from '@/components/BottomNav';
import { AddTransactionSheet } from '@/components/AddTransactionSheet';
import { toast } from 'sonner';
import { EmptyState } from '@/components/EmptyState';
import { formatARS, formatUSD, parseMoney } from '@/lib/format';
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

// Step a monthly anchor date by `delta` months, clamping to the target month's
// last day. Plain `new Date(y, m+1, d)` overflows for d=29–31 (Jan 31 → Mar 3)
// and the drifted day would be reused forever; keeping the original anchor day
// lets a 31st come back on 31-day months after clamping to Feb 28.
function stepMonthly(dt: Date, delta: number, anchorDay: number): Date {
  const y = dt.getFullYear();
  const m = dt.getMonth() + delta;
  const last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(anchorDay, last));
}

// Roll a stored monthly date (closing/due) forward one month at a time until it
// is today or later, so a card whose due date already passed shows the *next*
// due date instead of "vencido hace 40 días" forever.
function rollMonthlyForward(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  let dt = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let guard = 0;
  while (dt < today && guard < 60) {
    dt = stepMonthly(dt, 1, d);
    guard += 1;
  }
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
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

// A transaction tied to an account, with the fields needed to both list it and
// reopen it in the edit sheet. `categories` is the embedded category (name/icon).
interface AccountTx {
  id: string;
  account_id: string | null;
  transfer_account_id: string | null;
  type: string;
  amount: number;
  currency: string;
  occurred_on: string;
  merchant: string | null;
  description: string | null;
  category_id: string | null;
  scope: string;
  is_shared: boolean;
  installment_total: number | null;
  profile_id: string | null;
  categories: { name: string; icon: string } | null;
}

// One line in the account drill-down sheet: the transaction plus its signed
// amount (in its own currency) — negative leaves the account, positive arrives.
interface AccountMovement {
  tx: AccountTx;
  label: string;
  icon: string;
  amount: number;
}

function fmtMovementDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

// Bottom sheet listing every movement of one account, mirroring the budget
// drill-down on the Presupuestos screen. Tapping a row opens it for editing.
function AccountMovementsSheet({
  title,
  icon,
  rows,
  onSelect,
  onClose,
}: {
  title: string;
  icon: string;
  rows: AccountMovement[];
  onSelect: (tx: AccountTx) => void;
  onClose: () => void;
}) {
  const fmt = (amount: number, currency: string) =>
    currency === 'USD' ? formatUSD(amount) : formatARS(amount);

  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: 'rgba(45,45,45,0.4)' }} onClick={onClose}>
      <div
        className="w-full rounded-t-3xl p-6 flex flex-col"
        style={{ background: '#FFFFFF', paddingBottom: 'max(24px, env(safe-area-inset-bottom))', maxHeight: '80vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 rounded-full mx-auto mb-5 shrink-0" style={{ background: '#ECE5DC' }} />
        <div className="flex items-center gap-2 mb-1 shrink-0 min-w-0">
          <span className="text-2xl">{icon}</span>
          <h2 className="text-lg font-black truncate" style={{ color: '#2D2D2D' }}>{title}</h2>
        </div>
        <p className="text-xs mb-4 shrink-0" style={{ color: '#6B6459' }}>
          {rows.length} {rows.length === 1 ? 'movimiento' : 'movimientos'} · tocá para editar
        </p>

        {rows.length === 0 ? (
          <p className="text-sm py-8 text-center" style={{ color: '#6B6459' }}>
            Esta cuenta todavía no tiene movimientos.
          </p>
        ) : (
          <div className="rounded-2xl overflow-y-auto" style={{ background: '#F9F5F0' }}>
            {rows.map((r, i) => (
              <button
                key={r.tx.id}
                onClick={() => onSelect(r.tx)}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
                style={{ borderTop: i > 0 ? '1px solid #ECE5DC' : 'none' }}
              >
                <span className="text-xl shrink-0">{r.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: '#2D2D2D' }}>{r.label}</p>
                  <p className="text-xs" style={{ color: '#6B6459' }}>{fmtMovementDate(r.tx.occurred_on)}</p>
                </div>
                <p
                  className="text-base font-black shrink-0"
                  style={{ color: r.amount < 0 ? '#FF7F6B' : '#5BA886', fontVariantNumeric: 'tabular-nums' }}
                >
                  {r.amount < 0 ? '-' : '+'}{fmt(Math.abs(r.amount), r.tx.currency)}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
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
  const [fabType, setFabType] = useState<'expense' | 'income' | 'transfer'>('expense');
  // Account whose movements are shown in the drill-down sheet (tap a card).
  const [detailAccountId, setDetailAccountId] = useState<string | null>(null);
  // Movement tapped in the drill-down, opened in the edit sheet.
  const [editTx, setEditTx] = useState<AccountTx | null>(null);

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
        .eq('owner_profile_id', profile.id)
        .order('name');
      return data ?? [];
    },
  });

  // All transactions with an account, to compute live balances / card spend
  // and to list the movements behind each account when its card is tapped.
  // Carries the full row (scope, splits, installments…) so tapping a movement
  // can open the edit sheet directly.
  const { data: accountTx = [] } = useQuery<AccountTx[]>({
    queryKey: ['account-tx', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('id, account_id, transfer_account_id, type, amount, currency, occurred_on, merchant, description, category_id, scope, is_shared, installment_total, profile_id, categories:category_id(name, icon)')
        .eq('household_id', profile.household_id)
        .not('account_id', 'is', null);
      return (data as AccountTx[]) ?? [];
    },
  });

  const todayStr = todayISO();
  const monthStart = todayStr.slice(0, 7) + '-01';

  // Asset accounts: saldo = inicial + ingresos - gastos (hasta hoy).
  // Tarjetas: gastado en el mes actual.
  function assetBalance(accountId: string, initial: number) {
    return accountTx.reduce((s, t) => {
      if (t.occurred_on > todayStr) return s;
      if (t.account_id === accountId) {
        if (t.type === 'income') return s + t.amount;
        if (t.type === 'expense') return s - t.amount;
        if (t.type === 'transfer') return s - t.amount; // money leaves origin
        return s;
      }
      // Destination side of a transfer: money arrives here.
      if (t.type === 'transfer' && t.transfer_account_id === accountId) return s + t.amount;
      return s;
    }, initial);
  }
  // Start of the current billing cycle: the most recent closing date on/before
  // today (charges accrue from the day after the last close). Falls back to the
  // calendar month when the card has no closing date set.
  function cardCycleStart(closingISO: string | null | undefined): string {
    if (!closingISO) return monthStart;
    const [y, m, d] = closingISO.split('-').map(Number);
    let close = new Date(y, m - 1, d);
    const today = new Date(todayStr + 'T00:00:00');
    // Step the monthly closing date until it's the last one on/before today,
    // clamping to each month's last day so a 31st never drifts (Jan 31 → Mar 3).
    let guard = 0;
    while (close > today && guard < 120) { close = stepMonthly(close, -1, d); guard += 1; }
    guard = 0;
    while (stepMonthly(close, 1, d) <= today && guard < 120) {
      close = stepMonthly(close, 1, d); guard += 1;
    }
    // Cycle opens the day after the last close.
    const next = new Date(close.getFullYear(), close.getMonth(), close.getDate() + 1);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
  }

  // Spend accrued on a credit card during the current billing cycle, net of
  // payments to the card (a transfer into it) and refunds (income to it).
  function cardCycleSpend(accountId: string, closingISO: string | null | undefined) {
    const start = cardCycleStart(closingISO);
    let charges = 0;
    let credits = 0;
    for (const t of accountTx) {
      if (t.occurred_on < start || t.occurred_on > todayStr) continue;
      if (t.account_id === accountId) {
        if (t.type === 'expense') charges += t.amount;
        else if (t.type === 'income') credits += t.amount; // refund/credit note
      } else if (t.type === 'transfer' && t.transfer_account_id === accountId) {
        credits += t.amount; // paying down the card
      }
    }
    return Math.max(0, charges - credits);
  }

  // Movements tied to an account, newest first. Each row carries a signed amount
  // in its own currency: money leaving the account is negative (expense, or a
  // transfer out), money arriving is positive (income, or a transfer in). The
  // label prefers the movement's own name (merchant, then description) and falls
  // back to its category before a generic word.
  function movementsForAccount(accountId: string): AccountMovement[] {
    return accountTx
      .filter((t) => t.account_id === accountId || (t.type === 'transfer' && t.transfer_account_id === accountId))
      .map((t) => {
        const incoming = t.transfer_account_id === accountId && t.type === 'transfer';
        const sign = incoming || t.type === 'income' ? 1 : -1;
        const label = t.merchant
          || t.description
          || (incoming ? 'Transferencia recibida' : t.type === 'transfer' ? 'Transferencia' : t.categories?.name)
          || (t.type === 'income' ? 'Ingreso' : 'Gasto');
        return {
          tx: t,
          label,
          icon: incoming || t.type === 'transfer' ? '🔁' : (t.categories?.icon ?? (t.type === 'income' ? '💰' : '🛒')),
          amount: sign * t.amount,
        };
      })
      .sort((a, b) => b.tx.occurred_on.localeCompare(a.tx.occurred_on));
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
      const initialBalanceNum = parseMoney(initialBalance);
      // Statement fields only apply to credit cards; clear them otherwise.
      const isCredit = type === 'credit';
      const cardFields = {
        statement_ars: isCredit ? parseMoney(statementArs) || null : null,
        statement_usd: isCredit ? parseMoney(statementUsd) || null : null,
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
                      value={parseMoney(statementArs)}
                      onChange={(n) => setStatementArs(n ? String(n) : '')}
                      className="flex-1 w-full px-4 py-3 rounded-2xl border text-sm outline-none"
                      style={{ borderColor: '#ECE5DC' }}
                    />
                    <MoneyInput
                      placeholder="Total USD"
                      value={parseMoney(statementUsd)}
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
                  value={parseMoney(initialBalance)}
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
            onClick={() => setDetailAccountId(a.id)}
            role="button"
            tabIndex={0}
            className="rounded-3xl px-5 py-4 flex items-center gap-3 cursor-pointer"
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
                (() => {
                  const cycleSpend = cardCycleSpend(a.id, a.closing_date);
                  const hasStatement = a.statement_ars || a.statement_usd;
                  const nextDue = a.due_date ? rollMonthlyForward(a.due_date) : null;
                  return (
                    <div className="mt-1">
                      {hasStatement && (
                        <p className="text-sm font-black" style={{ color: '#FF7F6B' }}>
                          {[
                            a.statement_ars ? formatARS(a.statement_ars) : null,
                            a.statement_usd ? formatUSD(a.statement_usd) : null,
                          ].filter(Boolean).join(' + ')}
                          <span className="text-xs font-semibold" style={{ color: '#6B6459' }}> resumen</span>
                        </p>
                      )}
                      {/* New charges accruing toward the next statement (net of payments). */}
                      <p className={hasStatement ? 'text-xs font-semibold' : 'text-sm font-black'} style={{ color: hasStatement ? '#6B6459' : '#FF7F6B' }}>
                        {formatARS(cycleSpend)}
                        <span className="text-xs font-semibold" style={{ color: '#6B6459' }}>
                          {a.closing_date ? ' del ciclo actual' : ' gastado este mes'}
                        </span>
                      </p>
                      {nextDue && (
                        <p className="text-xs font-bold mt-0.5" style={{ color: daysUntil(nextDue) <= 3 ? '#E5604C' : '#6B6459' }}>
                          {dueLabel(nextDue)}
                          {a.closing_date ? ` · cierre ${rollMonthlyForward(a.closing_date).slice(8, 10)}/${rollMonthlyForward(a.closing_date).slice(5, 7)}` : ''}
                        </p>
                      )}
                    </div>
                  );
                })()
              ) : (
                (() => {
                  const bal = assetBalance(a.id, a.initial_balance ?? 0);
                  return (
                    <p className="text-sm font-black mt-1" style={{ color: bal < 0 ? '#FF7F6B' : '#5BA886' }}>
                      {a.currency === 'USD' ? formatUSD(bal) : formatARS(bal)}
                      <span className="text-xs font-semibold" style={{ color: '#6B6459' }}> saldo actual</span>
                    </p>
                  );
                })()
              )}
            </div>
            <div className="flex gap-2 flex-shrink-0">
              {!a.archived && (
                <button
                  onClick={(e) => { e.stopPropagation(); openEdit(a); }}
                  className="text-xs font-bold px-3 py-1.5 rounded-xl border"
                  style={{ borderColor: '#ECE5DC', color: '#6B6459' }}
                >
                  Editar
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); handleArchive(a.id, a.archived); }}
                className="text-xs font-bold px-3 py-1.5 rounded-xl border"
                style={{ borderColor: '#ECE5DC', color: '#6B6459' }}
              >
                {a.archived ? 'Restaurar' : 'Archivar'}
              </button>
            </div>
          </div>
        ))}
      </div>

      <BottomNav onFab={(type) => { setEditTx(null); setFabType(type); setSheetOpen(true); }} />
      <AddTransactionSheet
        open={sheetOpen}
        initialType={fabType}
        onClose={() => { setSheetOpen(false); setEditTx(null); }}
        householdId={profile.household_id}
        profileId={profile.id}
        categories={categories}
        accounts={accounts.filter((a) => !a.archived)}
        editTx={editTx}
      />

      {detailAccountId && (() => {
        const acc = accounts.find((a) => a.id === detailAccountId);
        if (!acc) return null;
        return (
          <AccountMovementsSheet
            title={acc.name}
            icon={acc.type === 'cash' ? '💵' : acc.type === 'credit' ? '💳' : '🏦'}
            rows={movementsForAccount(acc.id)}
            onSelect={(tx) => { setDetailAccountId(null); setEditTx(tx); setSheetOpen(true); }}
            onClose={() => setDetailAccountId(null)}
          />
        );
      })()}
    </div>
  );
}
