'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { formatARS } from '@/lib/format';
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
  cadence: 'weekly' | 'biweekly' | 'monthly';
  anchor_day: number | null;
  next_run: string | null;
  active: boolean;
  scope: string;
  category_id: string | null;
}

const CADENCE_LABEL: Record<string, string> = {
  weekly: 'Semanal',
  biweekly: 'Quincenal',
  monthly: 'Mensual',
};

function nextRunFromAnchor(cadence: string, anchorDay: number): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();

  if (cadence === 'monthly') {
    let d = new Date(year, month, anchorDay);
    if (d <= today) d = new Date(year, month + 1, anchorDay);
    return d.toISOString().split('T')[0];
  }
  if (cadence === 'weekly') {
    // next occurrence of weekday (anchorDay 0=Sun..6=Sat)
    const d = new Date(today);
    d.setDate(d.getDate() + ((anchorDay - d.getDay() + 7) % 7 || 7));
    return d.toISOString().split('T')[0];
  }
  if (cadence === 'biweekly') {
    // Use anchor_day as day-of-month for first occurrence; second 14 days later
    let d = new Date(year, month, anchorDay);
    if (d <= today) d = new Date(d.getTime() + 14 * 86400000);
    if (d <= today) d = new Date(year, month + 1, anchorDay);
    return d.toISOString().split('T')[0];
  }
  return today.toISOString().split('T')[0];
}

function RuleForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Partial<Rule>;
  onSave: (data: Omit<Rule, 'id'>) => void;
  onCancel: () => void;
}) {
  const [direction, setDirection] = useState<'income' | 'expense'>(
    initial?.direction ?? 'expense',
  );
  const [label, setLabel] = useState(initial?.label ?? '');
  const [amountStr, setAmountStr] = useState(initial?.amount ? String(initial.amount) : '');
  const [cadence, setCadence] = useState<'weekly' | 'biweekly' | 'monthly'>(
    initial?.cadence ?? 'monthly',
  );
  const [anchorDay, setAnchorDay] = useState(
    initial?.anchor_day != null ? String(initial.anchor_day) : '1',
  );
  const [scope, setScope] = useState(initial?.scope ?? 'household');
  const [active, setActive] = useState(initial?.active ?? true);

  function handleSave() {
    const amount = parseInt(amountStr, 10);
    if (!label.trim() || !amount || amount <= 0) {
      toast.error('Completá el nombre y el monto.');
      return;
    }
    const anchor = parseInt(anchorDay, 10) || 1;
    const next_run = nextRunFromAnchor(cadence, anchor);
    onSave({ direction, label: label.trim(), amount, cadence, anchor_day: anchor, next_run, scope, active, category_id: initial?.category_id ?? null });
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
              color: direction === d ? '#FFFFFF' : '#8A8276',
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

      {/* Amount */}
      <input
        type="number"
        placeholder="Monto en ARS"
        value={amountStr}
        onChange={(e) => setAmountStr(e.target.value)}
        className="w-full px-4 py-3 rounded-2xl text-sm border outline-none"
        style={{ borderColor: '#ECE5DC', color: '#2D2D2D' }}
        inputMode="numeric"
      />

      {/* Cadence */}
      <div>
        <p className="text-xs font-semibold mb-2" style={{ color: '#8A8276' }}>Frecuencia</p>
        <div className="flex gap-2">
          {(['weekly', 'biweekly', 'monthly'] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCadence(c)}
              className="flex-1 py-2 rounded-xl text-xs font-bold border transition-colors"
              style={{
                background: cadence === c ? '#E4F2EA' : '#FFFFFF',
                borderColor: cadence === c ? '#7EC8A4' : '#ECE5DC',
                color: cadence === c ? '#5BA886' : '#8A8276',
              }}
            >
              {CADENCE_LABEL[c]}
            </button>
          ))}
        </div>
      </div>

      {/* Anchor day */}
      <div>
        <p className="text-xs font-semibold mb-1" style={{ color: '#8A8276' }}>
          {cadence === 'weekly' ? 'Día de semana (0=Dom … 6=Sáb)' : 'Día del mes'}
        </p>
        <input
          type="number"
          min={cadence === 'weekly' ? 0 : 1}
          max={cadence === 'weekly' ? 6 : 28}
          value={anchorDay}
          onChange={(e) => setAnchorDay(e.target.value)}
          className="w-24 px-4 py-2 rounded-xl text-sm border outline-none"
          style={{ borderColor: '#ECE5DC', color: '#2D2D2D' }}
        />
      </div>

      {/* Scope */}
      <button
        onClick={() => setScope(scope === 'personal' ? 'household' : 'personal')}
        className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border w-fit"
        style={{
          background: scope === 'household' ? '#E4F2EA' : '#FFFFFF',
          borderColor: scope === 'household' ? '#7EC8A4' : '#ECE5DC',
          color: scope === 'household' ? '#5BA886' : '#8A8276',
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
          color: active ? '#5BA886' : '#8A8276',
        }}
      >
        {active ? '✓ Activa' : '✗ Inactiva'}
      </button>

      <div className="flex gap-3">
        <button
          onClick={onCancel}
          className="flex-1 py-3 rounded-2xl text-sm font-bold border"
          style={{ borderColor: '#ECE5DC', color: '#8A8276', background: '#FFFFFF' }}
        >
          Cancelar
        </button>
        <button
          onClick={handleSave}
          className="flex-1 py-3 rounded-2xl text-sm font-bold text-white"
          style={{ background: '#7EC8A4' }}
        >
          Guardar
        </button>
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

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['recurring_rules', profile.household_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('recurring_rules')
        .select('id, direction, label, amount, cadence, anchor_day, next_run, active, scope, category_id')
        .eq('household_id', profile.household_id)
        .order('direction')
        .order('label');
      if (error) throw error;
      return (data ?? []) as Rule[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['recurring_rules'] });
    qc.invalidateQueries({ queryKey: ['projection'] });
  };

  const createMutation = useMutation({
    mutationFn: async (data: Omit<Rule, 'id'>) => {
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
    mutationFn: async ({ id, data }: { id: string; data: Omit<Rule, 'id'> }) => {
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
          <p className="text-xs" style={{ color: '#8A8276' }}>
            {CADENCE_LABEL[rule.cadence]} · día {rule.anchor_day}
            {rule.next_run ? ` · próx. ${rule.next_run}` : ''}
            {!rule.active ? ' · inactiva' : ''}
          </p>
        </div>
        <p
          className="font-black text-sm flex-shrink-0"
          style={{ color: rule.direction === 'income' ? '#7EC8A4' : '#FF7F6B' }}
        >
          {rule.direction === 'income' ? '+' : '-'}{formatARS(rule.amount)}
        </p>
        <div className="flex gap-1 ml-2 flex-shrink-0">
          <button
            onClick={() => setEditRule(rule)}
            className="text-xs px-2 py-1 rounded-lg border"
            style={{ borderColor: '#ECE5DC', color: '#8A8276' }}
          >
            ✏️
          </button>
          <button
            onClick={() => {
              if (confirm(`¿Eliminar "${rule.label}"?`)) deleteMutation.mutate(rule.id);
            }}
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
        <h1 className="text-2xl font-black" style={{ color: '#2D2D2D' }}>Reglas fijas</h1>
      </header>

      <div className="px-4 flex flex-col gap-4">
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
