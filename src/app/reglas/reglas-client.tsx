'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { formatARS, formatUSD, parseMoney } from '@/lib/format';
import { useFx } from '@/hooks/useFx';
import { toLocalISO } from '@/lib/date';
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

interface Rule {
  id: string;
  direction: 'income' | 'expense';
  label: string;
  amount: number;
  currency: 'ARS' | 'USD';
  cadence: 'weekly' | 'biweekly' | 'monthly';
  anchor_day: number | null;
  next_run: string | null;
  active: boolean;
  scope: string;
  profile_id: string;
  category_id: string | null;
}

// A rule's amount is stored in its own currency. Format it accordingly,
// and convert to ARS (using the blue rate) when aggregating mixed currencies.
function fmtMoney(amount: number, currency: string): string {
  return currency === 'USD' ? formatUSD(amount) : formatARS(amount);
}
function toArs(amount: number, currency: string, arsPerUsd: number): number {
  return currency === 'USD' ? Math.round(amount * arsPerUsd) : amount;
}

const CADENCE_LABEL: Record<string, string> = {
  weekly: 'Semanal',
  biweekly: 'Quincenal',
  monthly: 'Mensual',
};

const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

// Count how many times a given weekday (0=Sun..6=Sat) falls in a month.
function weekdayOccurrencesInMonth(weekday: number, year: number, month: number): number {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let count = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    if (new Date(year, month, day).getDay() === weekday) count++;
  }
  return count;
}

// Normalize any cadence to the actual amount for the current month so totals
// reflect the real number of occurrences (e.g. a weekly expense on Thursdays
// counts the exact number of Thursdays in this month, not an average of 4.33).
function monthlyEquivalent(amount: number, cadence: string, anchorDay: number | null): number {
  if (cadence === 'weekly') {
    const now = new Date();
    const weekday = anchorDay != null ? ((anchorDay % 7) + 7) % 7 : now.getDay();
    return amount * weekdayOccurrencesInMonth(weekday, now.getFullYear(), now.getMonth());
  }
  if (cadence === 'biweekly') return amount * 2;
  return amount;
}

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T00:00:00');
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

function UpcomingBills({ rules }: { rules: Rule[] }) {
  const { arsPerUsd } = useFx();
  const upcoming = rules
    .filter((r) => r.active && r.next_run != null && daysUntil(r.next_run) >= 0 && daysUntil(r.next_run) <= 35)
    .sort((a, b) => (a.next_run! < b.next_run! ? -1 : 1));

  if (upcoming.length === 0) return null;

  const totalExpense = upcoming
    .filter((r) => r.direction === 'expense')
    .reduce((s, r) => s + toArs(r.amount, r.currency, arsPerUsd), 0);

  function whenLabel(d: number) {
    if (d === 0) return 'Hoy';
    if (d === 1) return 'Mañana';
    return `En ${d} días`;
  }

  return (
    <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#6B6459' }}>Próximos vencimientos</p>
        <span className="text-xs font-black" style={{ color: '#FF7F6B' }}>{formatARS(totalExpense)}</span>
      </div>
      <div className="flex flex-col gap-2.5">
        {upcoming.map((r) => {
          const d = daysUntil(r.next_run!);
          const soon = d <= 3;
          return (
            <div key={r.id} className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-sm flex-shrink-0"
                style={{ background: r.direction === 'income' ? '#E4F2EA' : soon ? '#FFE7E2' : '#F0EDE8' }}
              >
                {r.direction === 'income' ? '💰' : '📤'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate" style={{ color: '#2D2D2D' }}>{r.label}</p>
                <p className="text-xs font-semibold" style={{ color: soon ? '#E5604C' : '#6B6459' }}>{whenLabel(d)}</p>
              </div>
              <p className="text-sm font-black flex-shrink-0" style={{ color: r.direction === 'income' ? '#7EC8A4' : '#FF7F6B' }}>
                {r.direction === 'income' ? '+' : '-'}{fmtMoney(r.amount, r.currency)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FixedSummaryCard({ rules }: { rules: Rule[] }) {
  const { arsPerUsd } = useFx();
  const active = rules.filter((r) => r.active);
  // Everything is normalized to ARS so USD and ARS rules can be summed together.
  const incomeMonthly = active
    .filter((r) => r.direction === 'income')
    .reduce((s, r) => s + monthlyEquivalent(toArs(r.amount, r.currency, arsPerUsd), r.cadence, r.anchor_day), 0);
  const expenseMonthly = active
    .filter((r) => r.direction === 'expense')
    .reduce((s, r) => s + monthlyEquivalent(toArs(r.amount, r.currency, arsPerUsd), r.cadence, r.anchor_day), 0);
  const margin = incomeMonthly - expenseMonthly;
  const savingsRate = incomeMonthly > 0 ? margin / incomeMonthly : null;
  const marginPositive = margin >= 0;

  if (active.length === 0) return null;

  return (
    <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
      <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: '#6B6459' }}>
        Resumen mensual estimado
      </p>
      <div className="flex gap-3 mb-4">
        <div className="flex-1 rounded-2xl px-3 py-3" style={{ background: '#E4F2EA' }}>
          <p className="text-[11px] font-semibold" style={{ color: '#5BA886' }}>Ingresos fijos</p>
          <p className="text-lg font-black leading-tight" style={{ color: '#5BA886', fontVariantNumeric: 'tabular-nums' }}>
            {formatARS(Math.round(incomeMonthly))}
          </p>
        </div>
        <div className="flex-1 rounded-2xl px-3 py-3" style={{ background: '#FFE7E2' }}>
          <p className="text-[11px] font-semibold" style={{ color: '#E5604C' }}>Gastos fijos</p>
          <p className="text-lg font-black leading-tight" style={{ color: '#E5604C', fontVariantNumeric: 'tabular-nums' }}>
            {formatARS(Math.round(expenseMonthly))}
          </p>
        </div>
      </div>
      <div className="flex items-end justify-between pt-3" style={{ borderTop: '1px solid #ECE5DC' }}>
        <div>
          <p className="text-[11px] font-semibold" style={{ color: '#6B6459' }}>Margen fijo / mes</p>
          <p
            className="text-2xl font-black leading-none"
            style={{ color: marginPositive ? '#5BA886' : '#E5604C', fontVariantNumeric: 'tabular-nums' }}
          >
            {!marginPositive && '−'}{formatARS(Math.abs(Math.round(margin)))}
          </p>
        </div>
        {savingsRate != null && (
          <div className="text-right">
            <p className="text-[11px] font-semibold" style={{ color: '#6B6459' }}>Ahorro fijo</p>
            <span
              className="inline-block text-sm font-black px-2.5 py-1 rounded-full"
              style={{
                background: savingsRate >= 0.2 ? '#E4F2EA' : savingsRate >= 0 ? '#FBF1D8' : '#FFE7E2',
                color: savingsRate >= 0.2 ? '#5BA886' : savingsRate >= 0 ? '#B8860B' : '#E5604C',
              }}
            >
              {Math.round(savingsRate * 100)}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function nextRunFromAnchor(cadence: string, anchorDay: number): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();

  if (cadence === 'monthly') {
    let d = new Date(year, month, anchorDay);
    if (d <= today) d = new Date(year, month + 1, anchorDay);
    return toLocalISO(d);
  }
  if (cadence === 'weekly') {
    // next occurrence of weekday (anchorDay 0=Sun..6=Sat)
    const d = new Date(today);
    d.setDate(d.getDate() + ((anchorDay - d.getDay() + 7) % 7 || 7));
    return toLocalISO(d);
  }
  if (cadence === 'biweekly') {
    // Use anchor_day as day-of-month for first occurrence; second 14 days later
    let d = new Date(year, month, anchorDay);
    if (d <= today) d = new Date(d.getTime() + 14 * 86400000);
    if (d <= today) d = new Date(year, month + 1, anchorDay);
    return toLocalISO(d);
  }
  return toLocalISO(today);
}

function RuleForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Partial<Rule>;
  onSave: (data: Omit<Rule, 'id' | 'profile_id'>) => void;
  onCancel: () => void;
}) {
  const [direction, setDirection] = useState<'income' | 'expense'>(
    initial?.direction ?? 'expense',
  );
  const [label, setLabel] = useState(initial?.label ?? '');
  const [amountStr, setAmountStr] = useState(initial?.amount ? String(initial.amount) : '');
  const [currency, setCurrency] = useState<'ARS' | 'USD'>(initial?.currency ?? 'ARS');
  const [cadence, setCadence] = useState<'weekly' | 'biweekly' | 'monthly'>(
    initial?.cadence ?? 'monthly',
  );
  const [anchorDay, setAnchorDay] = useState(
    initial?.anchor_day != null ? String(initial.anchor_day) : '1',
  );
  const [scope, setScope] = useState(initial?.scope ?? 'personal');
  const [active, setActive] = useState(initial?.active ?? true);

  function handleSave() {
    const amount = parseMoney(amountStr);
    if (!label.trim() || !amount || amount <= 0) {
      toast.error('Completá el nombre y el monto.');
      return;
    }
    const anchor = parseInt(anchorDay, 10) || 1;
    const next_run = nextRunFromAnchor(cadence, anchor);
    onSave({ direction, label: label.trim(), amount, currency, cadence, anchor_day: anchor, next_run, scope, active, category_id: initial?.category_id ?? null });
  }

  return (
    <div className="flex flex-col gap-4 p-5 rounded-3xl" style={{ background: '#FFFFFF' }}>
      {/* Direction */}
      <div className="flex rounded-2xl overflow-hidden" style={{ background: '#ECE5DC' }}>
        {(['income', 'expense'] as const).map((d) => (
          <button
            key={d}
            onClick={() => setDirection(d)}
            className="flex-1 py-2.5 text-sm font-bold transition-colors"
            style={{
              background: direction === d ? (d === 'income' ? '#7EC8A4' : '#FF7F6B') : 'transparent',
              color: direction === d ? '#FFFFFF' : '#6B6459',
              borderRadius: '14px',
            }}
          >
            {d === 'income' ? 'Ingreso' : 'Gasto'}
          </button>
        ))}
      </div>

      {/* Label */}
      <input
        type="text"
        placeholder="Nombre (ej: Sueldo, Alquiler…)"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
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

      {/* Cadence */}
      <div>
        <p className="text-xs font-semibold mb-2" style={{ color: '#6B6459' }}>Frecuencia</p>
        <div className="flex gap-2">
          {(['weekly', 'biweekly', 'monthly'] as const).map((c) => (
            <button
              key={c}
              onClick={() => {
                setCadence(c);
                // Keep anchor day within the valid range for the new cadence:
                // weekly uses 0..6 (weekday), others use 1..28 (day of month).
                const n = parseInt(anchorDay, 10);
                if (c === 'weekly' && (isNaN(n) || n > 6)) setAnchorDay('1');
                if (c !== 'weekly' && (isNaN(n) || n < 1)) setAnchorDay('1');
              }}
              className="flex-1 py-2 rounded-xl text-xs font-bold border transition-colors"
              style={{
                background: cadence === c ? '#E4F2EA' : '#FFFFFF',
                borderColor: cadence === c ? '#7EC8A4' : '#ECE5DC',
                color: cadence === c ? '#5BA886' : '#6B6459',
              }}
            >
              {CADENCE_LABEL[c]}
            </button>
          ))}
        </div>
      </div>

      {/* Anchor day */}
      <div>
        <p className="text-xs font-semibold mb-1" style={{ color: '#6B6459' }}>
          {cadence === 'weekly' ? 'Día de la semana' : 'Día del mes'}
        </p>
        {cadence === 'weekly' ? (
          <select
            value={anchorDay}
            onChange={(e) => setAnchorDay(e.target.value)}
            className="w-full px-4 py-2 rounded-xl text-sm border outline-none bg-white"
            style={{ borderColor: '#ECE5DC', color: '#2D2D2D' }}
          >
            {WEEKDAYS.map((d, i) => (
              <option key={i} value={String(i)}>{d}</option>
            ))}
          </select>
        ) : (
          <input
            type="number"
            min={1}
            max={28}
            value={anchorDay}
            onChange={(e) => setAnchorDay(e.target.value)}
            className="w-24 px-4 py-2 rounded-xl text-sm border outline-none"
            style={{ borderColor: '#ECE5DC', color: '#2D2D2D' }}
          />
        )}
      </div>

      {/* Scope */}
      <button
        onClick={() => setScope(scope === 'personal' ? 'household' : 'personal')}
        className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border w-fit"
        style={{
          background: scope === 'household' ? '#E4F2EA' : '#FFFFFF',
          borderColor: scope === 'household' ? '#7EC8A4' : '#ECE5DC',
          color: scope === 'household' ? '#5BA886' : '#6B6459',
        }}
      >
        {scope === 'household' ? '🏠 Hogar' : '👤 Personal'}
      </button>

      {/* Active toggle */}
      <button
        onClick={() => setActive((v) => !v)}
        className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border w-fit"
        style={{
          background: active ? '#E4F2EA' : '#FFFFFF',
          borderColor: active ? '#7EC8A4' : '#ECE5DC',
          color: active ? '#5BA886' : '#6B6459',
        }}
      >
        {active ? '✓ Activa' : '✗ Inactiva'}
      </button>

      <div className="flex gap-3">
        <SecondaryButton onClick={onCancel} className="flex-1 py-3 text-sm">
          Cancelar
        </SecondaryButton>
        <PrimaryButton
          onClick={handleSave}
          disabled={!label.trim() || !(parseMoney(amountStr) > 0)}
          className="flex-1 py-3 text-sm"
        >
          Guardar
        </PrimaryButton>
      </div>
    </div>
  );
}

export default function ReglasClient({ profile }: { profile: Profile }) {
  const supabase = createClient();
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fabType, setFabType] = useState<'expense' | 'income'>('expense');
  const [showForm, setShowForm] = useState(false);
  const [editRule, setEditRule] = useState<Rule | null>(null);
  const [confirmDeleteRule, setConfirmDeleteRule] = useState<Rule | null>(null);

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

  // Distinct key ('full') so it doesn't collide with the lighter ['recurring_rules',
  // household] query the Home uses. Each user only sees their own rules plus shared
  // household ones — the partner's personal rules (e.g. su sueldo o psicóloga) stay hidden.
  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['recurring_rules', profile.household_id, 'full'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('recurring_rules')
        .select('id, direction, label, amount, currency, cadence, anchor_day, next_run, active, scope, profile_id, category_id')
        .eq('household_id', profile.household_id)
        .order('direction')
        .order('label');
      if (error) throw error;
      return ((data ?? []) as Rule[]).filter((r) => r.scope === 'household' || r.profile_id === profile.id);
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['recurring_rules'] });
    qc.invalidateQueries({ queryKey: ['projection'] });
  };

  const createMutation = useMutation({
    mutationFn: async (data: Omit<Rule, 'id' | 'profile_id'>) => {
      const { error } = await supabase.from('recurring_rules').insert({
        ...data,
        household_id: profile.household_id,
        profile_id: profile.id,
        is_variable: false,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Regla creada ✓'); setShowForm(false); invalidate(); },
    onError: () => toast.error('No se pudo crear la regla.'),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Omit<Rule, 'id' | 'profile_id'> }) => {
      const { error } = await supabase.from('recurring_rules').update(data).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Regla actualizada ✓'); setEditRule(null); invalidate(); },
    onError: () => toast.error('No se pudo actualizar la regla.'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('recurring_rules').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Regla eliminada'); invalidate(); },
    onError: () => toast.error('No se pudo eliminar la regla.'),
  });

  const income = rules.filter((r) => r.direction === 'income');
  const expenses = rules.filter((r) => r.direction === 'expense');

  function RuleCard({ rule }: { rule: Rule }) {
    return (
      <div
        className="flex items-center gap-3 px-5 py-4"
        style={{ borderTop: '1px solid #ECE5DC' }}
      >
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-lg flex-shrink-0"
          style={{ background: rule.direction === 'income' ? '#E4F2EA' : '#FFE7E2' }}
        >
          {rule.direction === 'income' ? '💰' : '📤'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm truncate" style={{ color: '#2D2D2D' }}>{rule.label}</p>
          <p className="text-xs" style={{ color: '#6B6459' }}>
            {CADENCE_LABEL[rule.cadence]} · día {rule.anchor_day}
            {rule.next_run ? ` · próx. ${rule.next_run}` : ''}
            {!rule.active ? ' · inactiva' : ''}
          </p>
        </div>
        <p
          className="font-black text-sm flex-shrink-0"
          style={{ color: rule.direction === 'income' ? '#7EC8A4' : '#FF7F6B' }}
        >
          {rule.direction === 'income' ? '+' : '-'}{fmtMoney(rule.amount, rule.currency)}
        </p>
        <div className="flex gap-1 ml-2 flex-shrink-0">
          <button
            onClick={() => setEditRule(rule)}
            className="text-xs px-2 py-1 rounded-lg border"
            style={{ borderColor: '#ECE5DC', color: '#6B6459' }}
          >
            ✏️
          </button>
          <button
            onClick={() => setConfirmDeleteRule(rule)}
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
        <h1 className="text-2xl font-black" style={{ color: '#2D2D2D' }}>Ingresos y gastos fijos</h1>
      </header>

      <div className="px-4 flex flex-col gap-4">
        {/* Upcoming bills this month */}
        {!showForm && !editRule && <UpcomingBills rules={rules} />}

        {/* Monthly summary */}
        {!showForm && !editRule && rules.length > 0 && <FixedSummaryCard rules={rules} />}

        {/* New rule form */}
        {showForm && !editRule && (
          <RuleForm
            onSave={(data) => createMutation.mutate(data)}
            onCancel={() => setShowForm(false)}
          />
        )}

        {editRule && (
          <RuleForm
            initial={editRule}
            onSave={(data) => updateMutation.mutate({ id: editRule.id, data })}
            onCancel={() => setEditRule(null)}
          />
        )}

        {!showForm && !editRule && (
          <button
            onClick={() => setShowForm(true)}
            className="w-full py-4 rounded-3xl text-sm font-bold text-white"
            style={{ background: '#7EC8A4' }}
          >
            + Nueva regla
          </button>
        )}

        {/* Income rules */}
        {income.length > 0 && (
          <div className="rounded-3xl overflow-hidden" style={{ background: '#FFFFFF' }}>
            <div className="px-5 py-3" style={{ borderBottom: '1px solid #ECE5DC' }}>
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#7EC8A4' }}>
                Ingresos fijos
              </p>
            </div>
            {income.map((r) => <RuleCard key={r.id} rule={r} />)}
          </div>
        )}

        {/* Expense rules */}
        {expenses.length > 0 && (
          <div className="rounded-3xl overflow-hidden" style={{ background: '#FFFFFF' }}>
            <div className="px-5 py-3" style={{ borderBottom: '1px solid #ECE5DC' }}>
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#FF7F6B' }}>
                Gastos fijos
              </p>
            </div>
            {expenses.map((r) => <RuleCard key={r.id} rule={r} />)}
          </div>
        )}

        {!isLoading && rules.length === 0 && !showForm && (
          <EmptyState
            icon="📅"
            title="Sin reglas fijas"
            subtitle="Agregá ingresos o gastos recurrentes."
          />
        )}
      </div>

      <ConfirmDialog
        open={confirmDeleteRule !== null}
        title="¿Eliminar regla?"
        message={confirmDeleteRule ? `Se eliminará "${confirmDeleteRule.label}". Esta acción no se puede deshacer.` : undefined}
        confirmLabel="Eliminar"
        onConfirm={() => {
          if (confirmDeleteRule) deleteMutation.mutate(confirmDeleteRule.id);
          setConfirmDeleteRule(null);
        }}
        onCancel={() => setConfirmDeleteRule(null)}
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
