'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { formatARS, formatUSD, parseMoney } from '@/lib/format';
import { useFx } from '@/hooks/useFx';
import { useEnvelope } from '@/hooks/useEnvelope';
import { toLocalISO, monthKey } from '@/lib/date';
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
  account_id: string | null;
  is_variable: boolean;
}

type RuleFormData = Omit<Rule, 'id' | 'profile_id'>;

interface AccountOption {
  id: string;
  name: string;
  type: string;
  owner_profile_id?: string | null;
}

interface CategoryOption {
  id: string;
  name: string;
  icon: string | null;
  kind: string;
  is_group?: boolean | null;
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
// counts the exact number of Thursdays in this month, not an average of 4.33;
// a biweekly one counts its actual 14-day cycle dates, which can be 1–3).
function monthlyEquivalent(amount: number, cadence: string, anchorDay: number | null, nextRun: string | null): number {
  if (cadence === 'weekly') {
    const now = new Date();
    const weekday = anchorDay != null ? ((anchorDay % 7) + 7) % 7 : now.getDay();
    return amount * weekdayOccurrencesInMonth(weekday, now.getFullYear(), now.getMonth());
  }
  if (cadence === 'biweekly') {
    // Walk the 14-day cycle anchored at next_run and count the occurrences
    // landing in the current month — same exact-count idea as the weekly case.
    // (ms arithmetic is safe: Argentina has no DST, so days are always 24h.)
    if (!nextRun) return amount * 2;
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const step = 14 * 86400000;
    const monthStart = new Date(year, month, 1).getTime();
    let t = new Date(nextRun + 'T00:00:00').getTime();
    // Align to the first cycle date on/after the start of this month.
    while (t - step >= monthStart) t -= step;
    while (t < monthStart) t += step;
    let count = 0;
    for (let d = new Date(t); d.getFullYear() === year && d.getMonth() === month; d = new Date(d.getTime() + step)) {
      count++;
    }
    return amount * count;
  }
  return amount;
}

// --- Subscription detection -------------------------------------------------

// Normalization for merchant names and rule labels: lowercase, accents
// stripped (NFD + remove combining marks), non-alphanumerics removed, so
// "Café Martínez" ≈ "CAFE-MARTINEZ" ≈ "cafe martinez".
function normalizeMerchant(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// Dismissed suggestions persist locally as a set of normalized merchants.
const DISMISSED_SUBS_KEY = 'morchis-dismissed-subscriptions';

function loadDismissedSubs(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem(DISMISSED_SUBS_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

// Slice of a transaction the detector needs (merchant is non-null by query).
interface ScanTx {
  merchant: string | null;
  amount: number;
  currency: 'ARS' | 'USD';
  occurred_on: string;
  category_id: string | null;
  profile_id: string;
  scope: string;
}

interface SubscriptionSuggestion {
  key: string; // normalized merchant
  merchant: string; // as shown (most recent spelling)
  amount: number; // most recent amount
  currency: 'ARS' | 'USD';
  anchorDay: number; // day-of-month of the last occurrence, clamped 1–28
  scope: string;
  profileId: string;
  categoryId: string | null;
}

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T00:00:00');
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

function UpcomingBills({ rules, availableByCat, onEdit }: { rules: Rule[]; availableByCat: Map<string, number>; onEdit: (r: Rule) => void }) {
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
          // Funding status: only for categorized expenses. Approximate — `available`
          // is per category, so multiple bills in one category share it.
          const amountArs = toArs(r.amount, r.currency, arsPerUsd);
          const funded = r.direction === 'expense' && r.category_id != null
            ? (availableByCat.get(r.category_id) ?? 0) >= amountArs
            : null;
          const shortfall = r.direction === 'expense' && r.category_id != null
            ? Math.max(0, amountArs - (availableByCat.get(r.category_id) ?? 0))
            : 0;
          return (
            <button
              key={r.id}
              onClick={() => onEdit(r)}
              aria-label={`Editar ${r.label}`}
              className="flex items-center gap-3 w-full text-left active:scale-[0.99] transition-transform"
            >
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-sm flex-shrink-0"
                style={{ background: r.direction === 'income' ? '#E4F2EA' : soon ? '#FFE7E2' : '#F0EDE8' }}
              >
                {r.direction === 'income' ? '💰' : '📤'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-bold truncate" style={{ color: '#2D2D2D' }}>{r.label}</p>
                  {r.is_variable && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: '#FBF1D8', color: '#B8860B' }}>
                      recordatorio
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-semibold" style={{ color: soon ? '#E5604C' : '#6B6459' }}>{whenLabel(d)}</p>
                  {funded === true && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#E4F2EA', color: '#5BA886' }}>Fondeado ✓</span>
                  )}
                  {funded === false && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#FBF1D8', color: '#B8860B' }}>Falta {formatARS(shortfall)}</span>
                  )}
                </div>
              </div>
              <p className="text-sm font-black flex-shrink-0" style={{ color: r.direction === 'income' ? '#7EC8A4' : '#FF7F6B' }}>
                {r.direction === 'income' ? '+' : '-'}{fmtMoney(r.amount, r.currency)}
              </p>
              <span className="text-[11px] flex-shrink-0" style={{ color: '#C4B9AE' }}>✏️</span>
            </button>
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
    .reduce((s, r) => s + monthlyEquivalent(toArs(r.amount, r.currency, arsPerUsd), r.cadence, r.anchor_day, r.next_run), 0);
  const expenseMonthly = active
    .filter((r) => r.direction === 'expense')
    .reduce((s, r) => s + monthlyEquivalent(toArs(r.amount, r.currency, arsPerUsd), r.cadence, r.anchor_day, r.next_run), 0);
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

// A day-of-month for a given year/month, clamped to that month's length — mirrors
// the cron's `least(anchor_day, last_day_of_month)`. Without this, anchor day 31
// in February makes `new Date(year, 1, 31)` overflow into March and the schedule
// drifts. So anchor_day 31 means "último día del mes".
function dayOfMonth(year: number, month: number, day: number): Date {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, lastDay));
}

function nextRunFromAnchor(cadence: string, anchorDay: number): string {
  // Compare against start-of-today so a rule created ON its anchor day gets
  // next_run = today: the cron posts rules with next_run <= current_date, so
  // it still materializes today instead of silently skipping a whole cycle.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const year = today.getFullYear();
  const month = today.getMonth();

  if (cadence === 'monthly') {
    let d = dayOfMonth(year, month, anchorDay);
    if (d < today) d = dayOfMonth(year, month + 1, anchorDay);
    return toLocalISO(d);
  }
  if (cadence === 'weekly') {
    // next occurrence of weekday (anchorDay 0=Sun..6=Sat), today included
    const d = new Date(today);
    d.setDate(d.getDate() + ((anchorDay - d.getDay() + 7) % 7));
    return toLocalISO(d);
  }
  if (cadence === 'biweekly') {
    // Use anchor_day as day-of-month for first occurrence; second 14 days later
    let d = dayOfMonth(year, month, anchorDay);
    if (d < today) d = new Date(d.getTime() + 14 * 86400000);
    if (d < today) d = dayOfMonth(year, month + 1, anchorDay);
    return toLocalISO(d);
  }
  return toLocalISO(today);
}

// Advance next_run by one cycle WITHOUT posting — used to skip a single
// occurrence. Mirrors the cron's advancement (+7 / +14 / same anchor day next
// month, clamped to the month's length).
function advanceNextRun(rule: Rule): string {
  const base = new Date((rule.next_run ?? toLocalISO(new Date())) + 'T00:00:00');
  if (rule.cadence === 'weekly') return toLocalISO(new Date(base.getTime() + 7 * 86400000));
  if (rule.cadence === 'biweekly') return toLocalISO(new Date(base.getTime() + 14 * 86400000));
  const anchor = rule.anchor_day ?? base.getDate();
  return toLocalISO(dayOfMonth(base.getFullYear(), base.getMonth() + 1, anchor));
}

// Map a rule's cadence/amount to a monthly-budget target. Monthly bills become a
// monthly refill of the same amount; weekly bills a weekly refill (the envelope
// math scales by weeks/month); biweekly approximates two monthly occurrences.
function targetFromRule(amount: number, cadence: string): { cadence: 'monthly' | 'weekly'; amount: number } {
  if (cadence === 'weekly') return { cadence: 'weekly', amount };
  if (cadence === 'biweekly') return { cadence: 'monthly', amount: amount * 2 };
  return { cadence: 'monthly', amount };
}

function RuleForm({
  initial,
  accounts,
  categories,
  existingTargetCats,
  onSave,
  onCancel,
}: {
  initial?: Partial<Rule>;
  accounts: AccountOption[];
  categories: CategoryOption[];
  existingTargetCats: Set<string>;
  onSave: (data: RuleFormData, reserveInBudget: boolean) => void;
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
  const [accountId, setAccountId] = useState<string>(initial?.account_id ?? '');
  const [categoryId, setCategoryId] = useState<string>(initial?.category_id ?? '');
  const [isVariable, setIsVariable] = useState(initial?.is_variable ?? false);
  // For a new rule, default to reserving in the budget; when editing, only
  // default on if that category already has a target (don't silently re-create
  // one the user deleted).
  const [reserveInBudget, setReserveInBudget] = useState(
    initial?.id ? existingTargetCats.has(initial.category_id ?? '') : true,
  );

  // Only expense categories are pickable for an expense rule, income for income;
  // master groups (Fijos/Variables/…) are never a leaf category for a tx.
  const pickableCategories = categories.filter((c) => !c.is_group && c.kind === direction);

  function handleSave() {
    const amount = parseMoney(amountStr);
    if (!label.trim() || !amount || amount <= 0) {
      toast.error('Completá el nombre y el monto.');
      return;
    }
    // Clamp to the valid range: weekday 0..6 for weekly, day-of-month 1..31
    // otherwise (31 = último día del mes; nextRunFromAnchor and the cron both
    // clamp it to the actual month length).
    const parsed = parseInt(anchorDay, 10);
    const minAnchor = cadence === 'weekly' ? 0 : 1;
    const maxAnchor = cadence === 'weekly' ? 6 : 31;
    const anchor = Math.min(maxAnchor, Math.max(minAnchor, Number.isNaN(parsed) ? minAnchor : parsed));
    if (!Number.isNaN(parsed) && anchor !== parsed) {
      toast(`Día ajustado a ${anchor} (el rango válido es ${minAnchor}–${maxAnchor}).`);
    }
    // Only recompute the next run when the schedule actually changed. Editing
    // just the amount/label of an existing rule should keep its current cycle
    // (otherwise the date jumped forward and the projection shifted).
    const scheduleChanged = initial?.cadence !== cadence || initial?.anchor_day !== anchor;
    const next_run =
      initial?.next_run && !scheduleChanged ? initial.next_run : nextRunFromAnchor(cadence, anchor);
    const category_id = categoryId || null;
    // Reserving only applies to categorized expenses.
    const reserve = direction === 'expense' && !!category_id && reserveInBudget;
    onSave({ direction, label: label.trim(), amount, currency, cadence, anchor_day: anchor, next_run, scope, active, category_id, account_id: accountId || null, is_variable: isVariable }, reserve);
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
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={31}
              value={anchorDay}
              onChange={(e) => setAnchorDay(e.target.value)}
              className="w-24 px-4 py-2 rounded-xl text-sm border outline-none"
              style={{ borderColor: '#ECE5DC', color: '#2D2D2D' }}
            />
            <button
              type="button"
              onClick={() => setAnchorDay('31')}
              className="text-xs font-bold px-3 py-2 rounded-xl border"
              style={{
                background: anchorDay === '31' ? '#E4F2EA' : '#FFFFFF',
                borderColor: anchorDay === '31' ? '#7EC8A4' : '#ECE5DC',
                color: anchorDay === '31' ? '#5BA886' : '#6B6459',
              }}
            >
              Último día
            </button>
          </div>
        )}
      </div>

      {/* Category — where the materialized transaction lands in the budget */}
      <div>
        <p className="text-xs font-semibold mb-1" style={{ color: '#6B6459' }}>Categoría</p>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="w-full px-4 py-2.5 rounded-xl text-sm border outline-none bg-white"
          style={{ borderColor: '#ECE5DC', color: '#2D2D2D' }}
        >
          <option value="">Sin categoría</option>
          {pickableCategories.map((c) => (
            <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ` : ''}{c.name}</option>
          ))}
        </select>
      </div>

      {/* Reserve in budget — sync a monthly target so "Para asignar" sets aside
          money for this fixed expense (expenses with a category only). */}
      {direction === 'expense' && categoryId && (
        <button
          type="button"
          onClick={() => setReserveInBudget((v) => !v)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold border w-full text-left"
          style={{
            background: reserveInBudget ? '#E4F2EA' : '#FFFFFF',
            borderColor: reserveInBudget ? '#7EC8A4' : '#ECE5DC',
            color: reserveInBudget ? '#5BA886' : '#6B6459',
          }}
        >
          {reserveInBudget ? '✓ ' : '○ '}Reservar en presupuesto
          <span className="font-normal" style={{ color: '#6B6459' }}>· objetivo mensual en la categoría</span>
        </button>
      )}

      {/* Fixed vs variable — variable rules are NOT auto-posted by the cron;
          they show as a reminder so you enter the real amount yourself. */}
      <div>
        <p className="text-xs font-semibold mb-2" style={{ color: '#6B6459' }}>Tipo de monto</p>
        <div className="flex rounded-2xl overflow-hidden" style={{ background: '#ECE5DC' }}>
          {([['fijo', false], ['variable', true]] as const).map(([labelTxt, val]) => (
            <button
              key={labelTxt}
              type="button"
              onClick={() => setIsVariable(val)}
              className="flex-1 py-2.5 text-sm font-bold transition-colors"
              style={{
                background: isVariable === val ? '#7EC8A4' : 'transparent',
                color: isVariable === val ? '#FFFFFF' : '#6B6459',
                borderRadius: '14px',
              }}
            >
              {val ? 'Variable' : 'Fijo'}
            </button>
          ))}
        </div>
        {isVariable && (
          <p className="text-[11px] mt-1.5" style={{ color: '#6B6459' }}>
            No se registra solo: aparece como recordatorio para que cargues el monto real.
          </p>
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

      {/* Account — where this rule credits (income) or debits (expense) */}
      <div>
        <p className="text-xs font-semibold mb-1" style={{ color: '#6B6459' }}>
          {direction === 'income' ? 'Se acredita en' : 'Se debita de'}
        </p>
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="w-full px-4 py-2.5 rounded-xl text-sm border outline-none bg-white"
          style={{ borderColor: '#ECE5DC', color: '#2D2D2D' }}
        >
          <option value="">Sin cuenta</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>

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
  const [fabType, setFabType] = useState<'expense' | 'income' | 'transfer'>('expense');
  const [showForm, setShowForm] = useState(false);
  const [editRule, setEditRule] = useState<Rule | null>(null);
  const [confirmDeleteRule, setConfirmDeleteRule] = useState<Rule | null>(null);

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase.from('categories').select('id, name, icon, kind, color, is_group').eq('household_id', profile.household_id).order('name');
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
        .select('id, direction, label, amount, currency, cadence, anchor_day, next_run, active, scope, profile_id, category_id, account_id, is_variable')
        .eq('household_id', profile.household_id)
        .order('direction')
        .order('label');
      if (error) throw error;
      return ((data ?? []) as Rule[]).filter((r) => r.scope === 'household' || r.profile_id === profile.id);
    },
  });

  // Last 4 calendar months of merchant expenses, scanned for likely
  // subscriptions the user hasn't registered as fixed rules.
  const { data: scanTxs = [] } = useQuery({
    queryKey: ['subscription_scan', profile.household_id],
    queryFn: async () => {
      const now = new Date();
      const start = toLocalISO(new Date(now.getFullYear(), now.getMonth() - 3, 1));
      const { data, error } = await supabase
        .from('transactions')
        .select('merchant, amount, currency, occurred_on, category_id, profile_id, scope')
        .eq('household_id', profile.household_id)
        .eq('type', 'expense')
        .not('merchant', 'is', null)
        .gte('occurred_on', start)
        .order('occurred_on', { ascending: false })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as ScanTx[];
    },
  });

  const [dismissedSubs, setDismissedSubs] = useState<string[]>(() => loadDismissedSubs());
  function dismissSuggestion(key: string) {
    setDismissedSubs((prev) => {
      const next = [...new Set([...prev, key])];
      try {
        localStorage.setItem(DISMISSED_SUBS_KEY, JSON.stringify(next));
      } catch {
        // localStorage unavailable (private mode/quota): dismissal lasts the session.
      }
      return next;
    });
  }

  // Group expenses by normalized merchant and flag the ones that look like a
  // subscription: ≥3 distinct months, similar amounts (max/min ≤ 1.3) and no
  // active rule whose label matches (substring either way, same normalization).
  const subscriptionSuggestions = useMemo<SubscriptionSuggestion[]>(() => {
    const groups = new Map<string, ScanTx[]>();
    for (const tx of scanTxs) {
      // Same visibility rule as the rest of the screen.
      if (tx.scope !== 'household' && tx.profile_id !== profile.id) continue;
      if (!tx.merchant) continue;
      const key = normalizeMerchant(tx.merchant);
      if (!key) continue;
      const arr = groups.get(key);
      if (arr) arr.push(tx);
      else groups.set(key, [tx]);
    }
    const activeLabels = rules
      .filter((r) => r.active)
      .map((r) => normalizeMerchant(r.label))
      .filter(Boolean);
    const out: SubscriptionSuggestion[] = [];
    for (const [key, txs] of groups) {
      if (dismissedSubs.includes(key)) continue;
      const months = new Set(txs.map((t) => t.occurred_on.slice(0, 7)));
      if (months.size < 3) continue;
      const amounts = txs.map((t) => t.amount);
      const min = Math.min(...amounts);
      const max = Math.max(...amounts);
      if (min <= 0 || max / min > 1.3) continue;
      if (activeLabels.some((l) => l.includes(key) || key.includes(l))) continue;
      // txs keep the query's most-recent-first order.
      const last = txs[0];
      out.push({
        key,
        merchant: last.merchant!,
        amount: last.amount,
        currency: last.currency,
        anchorDay: Math.min(28, Math.max(1, parseInt(last.occurred_on.slice(8, 10), 10) || 1)),
        scope: last.scope,
        profileId: last.profile_id,
        categoryId: last.category_id,
      });
    }
    return out.slice(0, 5);
  }, [scanTxs, rules, dismissedSubs, profile.id]);

  // Current-month envelope, to show whether each upcoming bill's category is
  // already funded and which categories already have a target.
  const env = useEnvelope(profile.household_id, profile.id, monthKey());
  const existingTargetCats = useMemo(
    () => new Set(env.targetInfoByCategory.keys()),
    [env.targetInfoByCategory],
  );

  // Active rules whose merchant still appears in spending but at a notably
  // different amount than the rule records — likely a price change to review.
  const priceChangeSuggestions = useMemo(() => {
    const out: { ruleId: string; label: string; oldAmount: number; newAmount: number; currency: 'ARS' | 'USD'; categoryId: string | null; reserve: boolean; cadence: Rule['cadence'] }[] = [];
    for (const r of rules) {
      if (!r.active) continue;
      const key = normalizeMerchant(r.label);
      if (!key) continue;
      const matches = scanTxs.filter(
        (t) =>
          (t.scope === 'household' || t.profile_id === profile.id) &&
          t.currency === r.currency &&
          t.merchant != null &&
          (() => { const m = normalizeMerchant(t.merchant!); return m.includes(key) || key.includes(m); })(),
      );
      if (matches.length === 0) continue;
      const latest = matches[0].amount; // query is most-recent-first
      if (latest <= 0 || r.amount <= 0) continue;
      const ratio = latest / r.amount;
      if (ratio > 1.15 || ratio < 0.87) {
        out.push({
          ruleId: r.id,
          label: r.label,
          oldAmount: r.amount,
          newAmount: latest,
          currency: r.currency,
          categoryId: r.category_id,
          reserve: existingTargetCats.has(r.category_id ?? ''),
          cadence: r.cadence,
        });
      }
    }
    return out.slice(0, 5);
  }, [rules, scanTxs, profile.id, existingTargetCats]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['recurring_rules'] });
    qc.invalidateQueries({ queryKey: ['projection'] });
  };

  // Mirror a rule into its category's monthly/weekly budget target so "Para
  // asignar" reserves money for it. Non-destructive: callers only invoke this
  // when the user opted in. The target belongs to the current user (each person
  // budgets their own envelopes), keyed unique per (profile, category).
  async function syncTargetFromRule(data: RuleFormData) {
    if (data.direction !== 'expense' || !data.category_id) return;
    const t = targetFromRule(data.amount, data.cadence);
    const { error } = await supabase.from('category_targets').upsert(
      {
        household_id: profile.household_id,
        profile_id: profile.id,
        category_id: data.category_id,
        target_amount: t.amount,
        cadence: t.cadence,
        target_date: null,
        target_type: 'refill',
        currency: data.currency,
      },
      { onConflict: 'profile_id,category_id' },
    );
    if (error) throw error;
    qc.invalidateQueries({ queryKey: ['envelope-targets', profile.id] });
  }

  const createMutation = useMutation({
    mutationFn: async ({ data, reserve }: { data: RuleFormData; reserve: boolean }) => {
      const { error } = await supabase.from('recurring_rules').insert({
        ...data,
        household_id: profile.household_id,
        profile_id: profile.id,
      });
      if (error) throw error;
      if (reserve) await syncTargetFromRule(data);
    },
    onSuccess: () => { toast.success('Regla creada ✓'); setShowForm(false); invalidate(); },
    onError: () => toast.error('No se pudo crear la regla.'),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data, reserve }: { id: string; data: RuleFormData; reserve: boolean }) => {
      const { error } = await supabase.from('recurring_rules').update(data).eq('id', id);
      if (error) throw error;
      if (reserve) await syncTargetFromRule(data);
    },
    onSuccess: () => { toast.success('Regla actualizada ✓'); setEditRule(null); invalidate(); },
    onError: () => toast.error('No se pudo actualizar la regla.'),
  });

  // Skip the next occurrence: advance next_run by one cycle without posting.
  const skipMutation = useMutation({
    mutationFn: async (rule: Rule) => {
      const { error } = await supabase
        .from('recurring_rules')
        .update({ next_run: advanceNextRun(rule) })
        .eq('id', rule.id);
      if (error) throw error;
    },
    onSuccess: (_d, rule) => { toast.success(`Saltada la próxima de "${rule.label}"`); invalidate(); },
    onError: () => toast.error('No se pudo saltar la ocurrencia.'),
  });

  // Update just a rule's amount from a detected price change (re-syncs the
  // target when that category was already being reserved).
  const updateAmountMutation = useMutation({
    mutationFn: async (s: { ruleId: string; newAmount: number; categoryId: string | null; currency: 'ARS' | 'USD'; cadence: Rule['cadence']; reserve: boolean }) => {
      const { error } = await supabase.from('recurring_rules').update({ amount: s.newAmount }).eq('id', s.ruleId);
      if (error) throw error;
      if (s.reserve && s.categoryId) {
        await syncTargetFromRule({ direction: 'expense', category_id: s.categoryId, amount: s.newAmount, currency: s.currency, cadence: s.cadence } as RuleFormData);
      }
    },
    onSuccess: () => { toast.success('Monto actualizado ✓'); invalidate(); },
    onError: () => toast.error('No se pudo actualizar el monto.'),
  });

  // Pre-create a monthly rule from a detected subscription. The scope/profile
  // come from the most recent occurrence, not from the current user.
  const createFromSuggestionMutation = useMutation({
    mutationFn: async (s: SubscriptionSuggestion) => {
      const { error } = await supabase.from('recurring_rules').insert({
        household_id: profile.household_id,
        profile_id: s.profileId,
        direction: 'expense',
        label: s.merchant,
        amount: s.amount,
        currency: s.currency,
        cadence: 'monthly',
        anchor_day: s.anchorDay,
        next_run: nextRunFromAnchor('monthly', s.anchorDay),
        scope: s.scope,
        active: true,
        category_id: s.categoryId,
        account_id: null,
        is_variable: false,
      });
      if (error) throw error;
    },
    // No need to touch dismissedSubs: once the rule exists, its active label
    // matches the merchant and the suggestion drops out on refetch.
    onSuccess: () => { toast.success('Regla creada ✓'); invalidate(); },
    onError: () => toast.error('No se pudo crear la regla.'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('recurring_rules').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Regla eliminada'); invalidate(); },
    onError: () => toast.error('No se pudo eliminar la regla.'),
  });

  const cashRules = rules;
  const income = cashRules.filter((r) => r.direction === 'income');
  const expenses = cashRules.filter((r) => r.direction === 'expense');
  const availableByCat = useMemo(
    () => new Map([...env.rowByCategory].map(([id, r]) => [id, r.available] as [string, number])),
    [env.rowByCategory],
  );

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
          <div className="flex items-center gap-1.5">
            <p className="font-bold text-sm truncate" style={{ color: '#2D2D2D' }}>{rule.label}</p>
            {rule.is_variable && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: '#FBF1D8', color: '#B8860B' }}>
                estimado
              </span>
            )}
          </div>
          <p className="text-xs" style={{ color: '#6B6459' }}>
            {rule.cadence === 'weekly'
              ? `${CADENCE_LABEL[rule.cadence]} · ${WEEKDAYS[rule.anchor_day ?? 0]}`
              : `${CADENCE_LABEL[rule.cadence]} · ${rule.anchor_day === 31 ? 'último día' : `día ${rule.anchor_day}`}`}
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
          {rule.active && rule.next_run && (
            <button
              onClick={() => skipMutation.mutate(rule)}
              disabled={skipMutation.isPending}
              aria-label={`Saltar próxima de ${rule.label}`}
              title="Saltar próxima ocurrencia"
              className="text-xs px-2 py-1 rounded-lg border"
              style={{ borderColor: '#ECE5DC', color: '#6B6459' }}
            >
              ⏭
            </button>
          )}
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
        {/* Upcoming bills this month — tap one to edit it */}
        {!showForm && !editRule && <UpcomingBills rules={cashRules} availableByCat={availableByCat} onEdit={(r) => setEditRule(r)} />}

        {/* Monthly summary */}
        {!showForm && !editRule && cashRules.length > 0 && <FixedSummaryCard rules={cashRules} />}

        {/* Price changes: an active rule's merchant now charges a different amount */}
        {!showForm && !editRule && priceChangeSuggestions.length > 0 && (
          <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
            <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: '#6B6459' }}>
              📈 Cambios de precio detectados
            </p>
            <div className="flex flex-col gap-2.5">
              {priceChangeSuggestions.map((s) => (
                <div key={s.ruleId} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate" style={{ color: '#2D2D2D' }}>{s.label}</p>
                    <p className="text-xs" style={{ color: '#6B6459' }}>
                      {fmtMoney(s.oldAmount, s.currency)} → <span className="font-bold" style={{ color: s.newAmount > s.oldAmount ? '#E5604C' : '#5BA886' }}>{fmtMoney(s.newAmount, s.currency)}</span>
                    </p>
                  </div>
                  <button
                    onClick={() => updateAmountMutation.mutate({ ruleId: s.ruleId, newAmount: s.newAmount, categoryId: s.categoryId, currency: s.currency, cadence: s.cadence, reserve: s.reserve })}
                    disabled={updateAmountMutation.isPending}
                    className="flex-shrink-0 text-xs font-bold px-3 py-1.5 rounded-full text-white"
                    style={{ background: '#7EC8A4' }}
                  >
                    Actualizar regla
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Likely subscriptions: repeating merchant expenses without a rule */}
        {!showForm && !editRule && subscriptionSuggestions.length > 0 && (
          <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
            <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: '#6B6459' }}>
              📡 Posibles suscripciones detectadas
            </p>
            <div className="flex flex-col gap-2.5">
              {subscriptionSuggestions.map((s) => (
                <div key={s.key} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate" style={{ color: '#2D2D2D' }}>{s.merchant}</p>
                    <p className="text-xs" style={{ color: '#6B6459' }}>
                      Último cobro: {fmtMoney(s.amount, s.currency)}
                    </p>
                  </div>
                  <button
                    onClick={() => createFromSuggestionMutation.mutate(s)}
                    disabled={createFromSuggestionMutation.isPending}
                    className="flex-shrink-0 text-xs font-bold px-3 py-1.5 rounded-full text-white"
                    style={{ background: '#7EC8A4' }}
                  >
                    Crear regla fija
                  </button>
                  <button
                    onClick={() => dismissSuggestion(s.key)}
                    aria-label={`Descartar ${s.merchant}`}
                    className="flex-shrink-0 text-xs px-2 py-1 rounded-lg border"
                    style={{ borderColor: '#ECE5DC', color: '#6B6459' }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* New rule form */}
        {showForm && !editRule && (
          <RuleForm
            accounts={accounts}
            categories={categories}
            existingTargetCats={existingTargetCats}
            onSave={(data, reserve) => createMutation.mutate({ data, reserve })}
            onCancel={() => setShowForm(false)}
          />
        )}

        {editRule && (
          <RuleForm
            initial={editRule}
            accounts={accounts}
            categories={categories}
            existingTargetCats={existingTargetCats}
            onSave={(data, reserve) => updateMutation.mutate({ id: editRule.id, data, reserve })}
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

        {!isLoading && cashRules.length === 0 && !showForm && (
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
