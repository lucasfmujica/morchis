'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { useFx } from '@/hooks/useFx';
import { BottomNav } from '@/components/BottomNav';
import { AddTransactionSheet } from '@/components/AddTransactionSheet';
import { formatARS, formatUSD, parseMoney } from '@/lib/format';
import { MoneyInput } from '@/components/MoneyInput';
import { PrimaryButton } from '@/components/PrimaryButton';
import { EmptyState } from '@/components/EmptyState';
import {
  spentForBudget as computeSpentForBudget,
  budgetContribution,
  weekContribution,
  BUDGET_EXPENSE_SELECT,
  type BudgetExpenseRow,
} from '@/lib/budgets';
import { weekRange, shortDM } from '@/lib/date';

interface Profile {
  id: string;
  household_id: string;
  nickname: string | null;
  display_name: string | null;
}

interface Budget {
  id: string;
  category_id: string;
  scope: string;
  profile_id: string | null;
  amount: number;
  currency: string;
  active: boolean;
  period: string;
}

interface Category {
  id: string;
  name: string;
  icon: string;
  kind: string;
}

// One line in the drill-down sheet: a transaction and the ARS amount it
// contributes to the total being explained (its own share, for shared expenses).
interface DetailRow {
  id: string;
  label: string;
  occurred_on: string;
  shared: boolean;
  amountArs: number;
}

interface DetailView {
  title: string;
  subtitle: string;
  icon: string;
  total: number;
  rows: DetailRow[];
}

function fmtDetailDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

function barColor(pct: number): string {
  if (pct >= 1) return '#FF7F6B';
  if (pct >= 0.8) return '#F5A623';
  return '#7EC8A4';
}

// `spent` and `limitArs` are both in ARS for the math; we render them in the
// budget's own currency (so a USD budget shows US$).
function BudgetBar({ spent, limitArs, currency, arsPerUsd }: { spent: number; limitArs: number; currency: string; arsPerUsd: number }) {
  const pct = limitArs > 0 ? Math.min(spent / limitArs, 1) : 0;
  const over = limitArs > 0 && spent > limitArs;
  const color = barColor(limitArs > 0 ? spent / limitArs : 0);
  const fmt = (ars: number) =>
    currency === 'USD' && arsPerUsd > 0 ? formatUSD(Math.round(ars / arsPerUsd)) : formatARS(ars);

  return (
    <div>
      <div className="h-2.5 rounded-full overflow-hidden" style={{ background: '#ECE5DC' }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(pct * 100, 100)}%`, background: color }}
        />
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-xs font-semibold" style={{ color }}>
          {fmt(spent)} gastado
        </span>
        <span className="text-xs" style={{ color: over ? '#FF7F6B' : '#6B6459' }}>
          {over ? `+${fmt(spent - limitArs)} excedido` : `de ${fmt(limitArs)}`}
        </span>
      </div>
    </div>
  );
}

function BudgetSheet({
  open,
  onClose,
  householdId,
  profileId,
  categories,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  householdId: string;
  profileId: string;
  categories: Category[];
  editing: Budget | null;
}) {
  const supabase = createClient();
  const qc = useQueryClient();

  const [categoryId, setCategoryId] = useState(editing?.category_id ?? '');
  const [amount, setAmount] = useState(editing ? String(editing.amount) : '');
  const [scope, setScope] = useState<'personal' | 'household'>(
    (editing?.scope as 'personal' | 'household') ?? 'personal',
  );
  const [currency, setCurrency] = useState<'ARS' | 'USD'>((editing?.currency as 'ARS' | 'USD') ?? 'ARS');
  const [period, setPeriod] = useState<'monthly' | 'weekly'>((editing?.period as 'monthly' | 'weekly') ?? 'monthly');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!categoryId || !amount) return;
    setSaving(true);
    const payload = {
      household_id: householdId,
      category_id: categoryId,
      scope,
      profile_id: scope === 'personal' ? profileId : null,
      amount: parseMoney(amount),
      currency,
      period,
      active: true,
    };
    if (editing) {
      await supabase.from('budgets').update(payload).eq('id', editing.id);
    } else {
      await supabase.from('budgets').insert(payload);
    }
    await qc.invalidateQueries({ queryKey: ['budgets'] });
    setSaving(false);
    onClose();
  }

  const expenseCategories = categories.filter((c) => c.kind === 'expense');

  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: 'rgba(45,45,45,0.4)' }} onClick={onClose}>
      <div
        className="w-full rounded-t-3xl p-6 pb-safe"
        style={{ background: '#FFFFFF', paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: '#ECE5DC' }} />
        <h2 className="text-lg font-black mb-5" style={{ color: '#2D2D2D' }}>
          {editing ? 'Editar presupuesto' : 'Nuevo presupuesto'}
        </h2>

        {/* Scope */}
        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#6B6459' }}>Alcance</p>
        <div className="flex rounded-2xl overflow-hidden mb-4 p-1 gap-1" style={{ background: '#ECE5DC' }}>
          {(['personal', 'household'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className="flex-1 py-1.5 text-xs font-bold rounded-xl transition-colors"
              style={{
                background: scope === s ? '#FFFFFF' : 'transparent',
                color: scope === s ? '#2D2D2D' : '#6B6459',
              }}
            >
              {s === 'personal' ? 'Personal' : 'Nuestro'}
            </button>
          ))}
        </div>

        {/* Period */}
        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#6B6459' }}>Período</p>
        <div className="flex rounded-2xl overflow-hidden mb-4 p-1 gap-1" style={{ background: '#ECE5DC' }}>
          {(['monthly', 'weekly'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className="flex-1 py-1.5 text-xs font-bold rounded-xl transition-colors"
              style={{
                background: period === p ? '#FFFFFF' : 'transparent',
                color: period === p ? '#2D2D2D' : '#6B6459',
              }}
            >
              {p === 'monthly' ? 'Mensual' : 'Semanal (Lun–Dom)'}
            </button>
          ))}
        </div>

        {/* Category */}
        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#6B6459' }}>Categoría</p>
        <div className="flex flex-wrap gap-2 mb-4 max-h-40 overflow-y-auto">
          {expenseCategories.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategoryId(c.id)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-sm font-semibold transition-colors"
              style={{
                background: categoryId === c.id ? '#7EC8A4' : '#F9F5F0',
                color: categoryId === c.id ? '#FFFFFF' : '#2D2D2D',
              }}
            >
              <span>{c.icon}</span>
              <span>{c.name}</span>
            </button>
          ))}
        </div>

        {/* Currency */}
        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#6B6459' }}>Moneda</p>
        <div className="flex rounded-2xl overflow-hidden mb-4 p-1 gap-1" style={{ background: '#ECE5DC' }}>
          {(['ARS', 'USD'] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCurrency(c)}
              className="flex-1 py-1.5 text-xs font-bold rounded-xl transition-colors"
              style={{
                background: currency === c ? '#FFFFFF' : 'transparent',
                color: currency === c ? '#2D2D2D' : '#6B6459',
              }}
            >
              {c === 'ARS' ? 'ARS (Pesos)' : 'USD (Dólares)'}
            </button>
          ))}
        </div>

        {/* Amount */}
        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#6B6459' }}>
          Límite {period === 'weekly' ? 'semanal' : 'mensual'} ({currency})
        </p>
        <MoneyInput
          value={parseMoney(amount)}
          onChange={(n) => setAmount(n ? String(n) : '')}
          placeholder={currency === 'USD' ? 'Ej: 440' : 'Ej: 50.000'}
          className="w-full rounded-2xl px-4 py-3 text-lg font-bold mb-5 outline-none border-2 transition-colors"
          style={{
            background: '#F9F5F0',
            color: '#2D2D2D',
            borderColor: amount ? '#7EC8A4' : '#ECE5DC',
          }}
        />

        <PrimaryButton
          onClick={save}
          disabled={!categoryId || !amount}
          loading={saving}
          className="w-full py-4"
        >
          {saving ? 'Guardando…' : 'Guardar'}
        </PrimaryButton>
      </div>
    </div>
  );
}

function TransactionsSheet({ view, onClose }: { view: DetailView; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: 'rgba(45,45,45,0.4)' }} onClick={onClose}>
      <div
        className="w-full rounded-t-3xl p-6 flex flex-col"
        style={{ background: '#FFFFFF', paddingBottom: 'max(24px, env(safe-area-inset-bottom))', maxHeight: '80vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 rounded-full mx-auto mb-5 shrink-0" style={{ background: '#ECE5DC' }} />
        <div className="flex items-start justify-between mb-1 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-2xl">{view.icon}</span>
            <h2 className="text-lg font-black truncate" style={{ color: '#2D2D2D' }}>{view.title}</h2>
          </div>
          <p className="text-lg font-black shrink-0 ml-3" style={{ color: '#FF7F6B', fontVariantNumeric: 'tabular-nums' }}>
            {formatARS(view.total)}
          </p>
        </div>
        <p className="text-xs mb-4 shrink-0" style={{ color: '#6B6459' }}>{view.subtitle}</p>

        {view.rows.length === 0 ? (
          <p className="text-sm py-8 text-center" style={{ color: '#6B6459' }}>
            No hay gastos que sumen a este total.
          </p>
        ) : (
          <div className="rounded-2xl overflow-y-auto" style={{ background: '#F9F5F0' }}>
            {view.rows.map((r, i) => (
              <div
                key={r.id}
                className="flex items-center gap-3 px-4 py-3.5"
                style={{ borderTop: i > 0 ? '1px solid #ECE5DC' : 'none' }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: '#2D2D2D' }}>{r.label}</p>
                  <p className="text-xs" style={{ color: '#6B6459' }}>
                    {fmtDetailDate(r.occurred_on)}{r.shared ? ' · compartido' : ''}
                  </p>
                </div>
                <p className="text-base font-black" style={{ color: '#FF7F6B', fontVariantNumeric: 'tabular-nums' }}>
                  -{formatARS(r.amountArs)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function PresupuestosClient({ profile }: { profile: Profile }) {
  const supabase = createClient();
  const qc = useQueryClient();
  const { arsPerUsd } = useFx();
  const [tab, setTab] = useState<'personal' | 'household'>('personal');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fabType, setFabType] = useState<'expense' | 'income'>('expense');
  const [editing, setEditing] = useState<Budget | null>(null);
  const [budgetSheetOpen, setBudgetSheetOpen] = useState(false);
  // Drill-down sheet: the transactions behind a budget's or the week's total.
  const [detail, setDetail] = useState<DetailView | null>(null);

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  // End of the current month, so a future-dated row (e.g. an installment booked
  // for a later month) doesn't inflate this month's budget spend / alerts.
  const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;
  const week = weekRange(now);
  // Load enough rows to cover both windows (the week can straddle a month edge).
  const rowsStart = week.start < monthStart ? week.start : monthStart;
  const rowsEnd = week.end > monthEnd ? week.end : monthEnd;

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['categories', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('categories')
        .select('id, name, icon, kind, color')
        .eq('household_id', profile.household_id)
        .order('name');
      return data ?? [];
    },
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('accounts')
        .select('id, name, type, owner_profile_id')
        .eq('household_id', profile.household_id)
        .eq('archived', false)
        .order('name');
      return data ?? [];
    },
  });

  const { data: budgets = [] } = useQuery<Budget[]>({
    queryKey: ['budgets', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('budgets')
        .select('*')
        .eq('household_id', profile.household_id)
        .eq('active', true);
      return data ?? [];
    },
  });

  // Load this month's expense rows (with scope, owner and splits) so each budget
  // counts the right spend: household budgets count the combined household spend,
  // personal budgets count only the owner's *share* of each expense — including
  // their part of shared expenses, no matter who actually paid.
  const { data: expenseRows = [] } = useQuery<BudgetExpenseRow[]>({
    queryKey: ['budget-expense-rows', profile.household_id, rowsStart, rowsEnd],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select(`${BUDGET_EXPENSE_SELECT}, id, merchant`)
        .eq('household_id', profile.household_id)
        .eq('type', 'expense')
        .gte('occurred_on', rowsStart)
        .lte('occurred_on', rowsEnd);
      return (data ?? []) as BudgetExpenseRow[];
    },
  });

  // Budgets are in ARS, so USD expenses are converted at the blue rate.
  const toArs = (amount: number, currency: string) =>
    currency === 'USD' && arsPerUsd > 0 ? Math.round(amount * arsPerUsd) : amount;

  // Rows inside a budget's period window. A weekly budget only counts Mon–Sun
  // of the current week; a monthly one counts the whole month.
  function rowsForPeriod(p: string): BudgetExpenseRow[] {
    const [from, to] = p === 'weekly' ? [week.start, week.end] : [monthStart, monthEnd];
    return expenseRows.filter((r) => r.occurred_on != null && r.occurred_on >= from && r.occurred_on <= to);
  }

  function spentForBudget(b: Budget): number {
    return computeSpentForBudget(b, rowsForPeriod(b.period), profile.id, arsPerUsd);
  }

  // "Esta semana" total for the active scope: my own share when on the Personal
  // tab, the combined household spend on the Nuestro tab.
  const weekRows = expenseRows.filter(
    (r) => r.occurred_on != null && r.occurred_on >= week.start && r.occurred_on <= week.end,
  );
  const weekSpend = weekRows.reduce(
    (sum, r) => sum + weekContribution(r, tab, profile.id, arsPerUsd),
    0,
  );

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from('budgets').update({ active: false }).eq('id', id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets'] }),
  });

  // Personal budgets are per-user: only show my own. Household budgets are shared.
  const filteredBudgets = budgets.filter(
    (b) => b.scope === tab && (tab === 'household' || b.profile_id === profile.id),
  );

  const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));

  function openNew() {
    setEditing(null);
    setBudgetSheetOpen(true);
  }

  function openEdit(b: Budget) {
    setEditing(b);
    setBudgetSheetOpen(true);
  }

  // Build the list of transactions behind a budget's spent total. Each row shows
  // the amount that actually counts toward the budget (a person's share for
  // shared expenses), so the rows add up to the total on the card.
  function openBudgetDetail(b: Budget) {
    const cat = catMap[b.category_id];
    const rows: DetailRow[] = rowsForPeriod(b.period)
      .map((t) => ({ t, amountArs: budgetContribution(b, t, profile.id, arsPerUsd) }))
      .filter(({ amountArs }) => amountArs > 0)
      .map(({ t, amountArs }) => ({
        id: t.id ?? `${t.occurred_on}-${amountArs}`,
        label: t.merchant || cat?.name || 'Gasto',
        occurred_on: t.occurred_on ?? '',
        shared: t.is_shared,
        amountArs,
      }))
      .sort((a, b2) => b2.occurred_on.localeCompare(a.occurred_on));
    setDetail({
      title: cat?.name ?? 'Presupuesto',
      subtitle: `${b.period === 'weekly' ? 'Esta semana' : 'Este mes'} · ${rows.length} ${rows.length === 1 ? 'gasto' : 'gastos'}`,
      icon: cat?.icon ?? '📦',
      total: spentForBudget(b),
      rows,
    });
  }

  function openWeekDetail() {
    const rows: DetailRow[] = weekRows
      .map((t) => ({ t, amountArs: weekContribution(t, tab, profile.id, arsPerUsd) }))
      .filter(({ amountArs }) => amountArs > 0)
      .map(({ t, amountArs }) => ({
        id: t.id ?? `${t.occurred_on}-${amountArs}`,
        label: t.merchant || catMap[t.category_id ?? '']?.name || 'Gasto',
        occurred_on: t.occurred_on ?? '',
        shared: t.is_shared,
        amountArs,
      }))
      .sort((a, b2) => b2.occurred_on.localeCompare(a.occurred_on));
    setDetail({
      title: tab === 'household' ? 'Gastos de la semana' : 'Gastaste esta semana',
      subtitle: `Lun ${shortDM(week.start)} – Dom ${shortDM(week.end)} · ${rows.length} ${rows.length === 1 ? 'gasto' : 'gastos'}`,
      icon: '🗓️',
      total: weekSpend,
      rows,
    });
  }

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F9F5F0' }}>
      <header className="flex items-center justify-between px-5 pt-14 pb-4">
        <h1 className="text-2xl font-black" style={{ color: '#2D2D2D' }}>Presupuestos</h1>
        <button
          onClick={openNew}
          className="w-9 h-9 rounded-full text-xl text-white flex items-center justify-center"
          style={{ background: '#7EC8A4' }}
        >
          +
        </button>
      </header>

      {/* Tabs */}
      <div className="mx-4 mb-4 flex rounded-2xl overflow-hidden p-1 gap-1" style={{ background: '#ECE5DC' }}>
        {(['personal', 'household'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="flex-1 py-1.5 text-xs font-bold rounded-xl transition-colors"
            style={{
              background: tab === t ? '#FFFFFF' : 'transparent',
              color: tab === t ? '#2D2D2D' : '#6B6459',
            }}
          >
            {t === 'personal' ? 'Personal' : 'Nuestro'}
          </button>
        ))}
      </div>

      {/* This week's spend (Mon–Sun) — tap to see the expenses behind it */}
      <button
        onClick={openWeekDetail}
        className="mx-4 mb-4 rounded-3xl p-5 w-[calc(100%-2rem)] text-left"
        style={{ background: '#FFFFFF' }}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#6B6459' }}>
              {tab === 'household' ? 'Gastos de la semana' : 'Gastaste esta semana'}
            </p>
            <p className="text-[11px]" style={{ color: '#6B6459' }}>
              Lun {shortDM(week.start)} – Dom {shortDM(week.end)} · ver detalle ›
            </p>
          </div>
          <p className="text-2xl font-black" style={{ color: '#FF7F6B', fontVariantNumeric: 'tabular-nums' }}>
            {formatARS(weekSpend)}
          </p>
        </div>
      </button>

      {/* Budget cards */}
      <div className="px-4 flex flex-col gap-3">
        {filteredBudgets.length === 0 ? (
          <EmptyState
            icon="📊"
            title="Sin presupuestos"
            subtitle="Creá un presupuesto para controlar tus gastos."
            action={{ label: 'Crear presupuesto', onClick: openNew }}
          />
        ) : (
          filteredBudgets.map((b) => {
            const cat = catMap[b.category_id];
            const spent = spentForBudget(b);
            const limitArs = toArs(b.amount, b.currency);
            const over = spent > limitArs;
            const near = !over && limitArs > 0 && spent / limitArs >= 0.8;
            return (
              <div
                key={b.id}
                onClick={() => openBudgetDetail(b)}
                role="button"
                tabIndex={0}
                className="rounded-3xl p-5 cursor-pointer"
                style={{ background: '#FFFFFF' }}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{cat?.icon ?? '📦'}</span>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <p className="font-bold text-sm" style={{ color: '#2D2D2D' }}>{cat?.name ?? '—'}</p>
                        <span
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{ background: '#ECE5DC', color: '#6B6459' }}
                        >
                          {b.period === 'weekly' ? 'Semanal' : 'Mensual'}
                        </span>
                      </div>
                      {over && (
                        <span
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{ background: '#FFE7E2', color: '#FF7F6B' }}
                        >
                          Excedido
                        </span>
                      )}
                      {near && (
                        <span
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{ background: '#FDF1D8', color: '#B8860B' }}
                        >
                          Cerca del límite · {Math.round((spent / limitArs) * 100)}%
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); openEdit(b); }}
                      className="text-xs px-3 py-1.5 rounded-xl font-semibold"
                      style={{ background: '#F9F5F0', color: '#6B6459' }}
                    >
                      Editar
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(b.id); }}
                      className="text-xs px-3 py-1.5 rounded-xl font-semibold"
                      style={{ background: '#FFE7E2', color: '#FF7F6B' }}
                    >
                      Borrar
                    </button>
                  </div>
                </div>
                <BudgetBar spent={spent} limitArs={limitArs} currency={b.currency} arsPerUsd={arsPerUsd} />
              </div>
            );
          })
        )}
      </div>

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

      {detail && <TransactionsSheet view={detail} onClose={() => setDetail(null)} />}

      {budgetSheetOpen && (
        <BudgetSheet
          key={editing?.id ?? 'new'}
          open={budgetSheetOpen}
          onClose={() => setBudgetSheetOpen(false)}
          householdId={profile.household_id}
          profileId={profile.id}
          categories={categories}
          editing={editing}
        />
      )}
    </div>
  );
}
