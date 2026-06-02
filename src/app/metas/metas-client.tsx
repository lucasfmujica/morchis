'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { BottomNav } from '@/components/BottomNav';
import { AddTransactionSheet } from '@/components/AddTransactionSheet';
import { formatARS, formatUSD, usdToArs } from '@/lib/format';
import { monthKey } from '@/lib/date';
import { MoneyInput } from '@/components/MoneyInput';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useFx } from '@/hooks/useFx';
import { useInflation } from '@/hooks/useInflation';
import { EmptyState } from '@/components/EmptyState';

interface Profile {
  id: string;
  household_id: string;
  nickname: string | null;
  display_name: string | null;
}

interface Goal {
  id: string;
  household_id: string;
  scope: string;
  profile_id: string | null;
  name: string;
  icon: string;
  color: string;
  target_amount: number;
  target_currency: 'ARS' | 'USD';
  current_amount: number;
  deadline: string;
  archived: boolean;
  created_at?: string;
}

const ICON_OPTIONS = ['🎯', '✈️', '🏠', '🚗', '💻', '📱', '🎓', '💍', '🌴', '🎸', '🏋️', '💰', '🛋️', '🐶', '🎁'];
const COLOR_OPTIONS = [
  '#7EC8A4', // sage
  '#FF7F6B', // coral
  '#6BAED6', // blue
  '#FDB863', // orange
  '#9E9AC8', // purple
  '#FC8D59', // red-orange
  '#74C476', // green
  '#F768A1', // pink
];

function ProgressRing({
  pct,
  color,
  size = 80,
  stroke = 8,
}: {
  pct: number;
  color: string;
  size?: number;
  stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const filled = Math.min(pct, 1) * circ;
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#ECE5DC" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circ}`}
        style={{ transition: 'stroke-dasharray 0.6s ease' }}
      />
    </svg>
  );
}

function GoalSheet({
  open,
  onClose,
  householdId,
  profileId,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  householdId: string;
  profileId: string;
  editing: Goal | null;
}) {
  const supabase = createClient();
  const qc = useQueryClient();

  const [name, setName] = useState(editing?.name ?? '');
  const [icon, setIcon] = useState(editing?.icon ?? '🎯');
  const [color, setColor] = useState(editing?.color ?? '#7EC8A4');
  const [targetAmount, setTargetAmount] = useState(editing ? String(editing.target_amount) : '');
  const [targetCurrency, setTargetCurrency] = useState<'ARS' | 'USD'>(editing?.target_currency ?? 'ARS');
  const [deadline, setDeadline] = useState(editing?.deadline ?? '');
  const [scope, setScope] = useState<'personal' | 'household'>((editing?.scope as 'personal' | 'household') ?? 'personal');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name || !targetAmount || !deadline) return;
    setSaving(true);
    const payload = {
      household_id: householdId,
      scope,
      profile_id: scope === 'personal' ? profileId : null,
      name,
      icon,
      color,
      target_amount: parseInt(targetAmount.replace(/\D/g, ''), 10),
      target_currency: targetCurrency,
      deadline,
      archived: false,
    };
    if (editing) {
      await supabase.from('goals').update(payload).eq('id', editing.id);
    } else {
      await supabase.from('goals').insert({ ...payload, current_amount: 0 });
    }
    await qc.invalidateQueries({ queryKey: ['goals'] });
    setSaving(false);
    onClose();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end"
      style={{ background: 'rgba(45,45,45,0.4)' }}
      onClick={onClose}
    >
      <div
        className="w-full rounded-t-3xl p-6 overflow-y-auto"
        style={{ background: '#FFFFFF', maxHeight: '90vh', paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: '#ECE5DC' }} />
        <h2 className="text-lg font-black mb-5" style={{ color: '#2D2D2D' }}>
          {editing ? 'Editar meta' : 'Nueva meta'}
        </h2>

        {/* Name */}
        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#6B6459' }}>Nombre</p>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej: Viaje a Brasil"
          className="w-full rounded-2xl px-4 py-3 text-base font-semibold mb-4 outline-none border-2 transition-colors"
          style={{ background: '#F9F5F0', color: '#2D2D2D', borderColor: name ? '#7EC8A4' : '#ECE5DC' }}
        />

        {/* Icon */}
        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#6B6459' }}>Ícono</p>
        <div className="flex flex-wrap gap-2 mb-4">
          {ICON_OPTIONS.map((ic) => (
            <button
              key={ic}
              onClick={() => setIcon(ic)}
              className="w-11 h-11 rounded-2xl text-2xl flex items-center justify-center transition-colors"
              style={{ background: icon === ic ? '#E4F2EA' : '#F9F5F0', border: icon === ic ? '2px solid #7EC8A4' : '2px solid transparent' }}
            >
              {ic}
            </button>
          ))}
        </div>

        {/* Color */}
        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#6B6459' }}>Color</p>
        <div className="flex gap-2 mb-4">
          {COLOR_OPTIONS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className="w-9 h-9 rounded-full transition-transform"
              style={{
                background: c,
                border: color === c ? '3px solid #2D2D2D' : '3px solid transparent',
                transform: color === c ? 'scale(1.15)' : 'scale(1)',
              }}
            />
          ))}
        </div>

        {/* Scope */}
        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#6B6459' }}>Alcance</p>
        <div className="flex rounded-2xl overflow-hidden mb-4 p-1 gap-1" style={{ background: '#ECE5DC' }}>
          {(['personal', 'household'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className="flex-1 py-1.5 text-xs font-bold rounded-xl transition-colors"
              style={{ background: scope === s ? '#FFFFFF' : 'transparent', color: scope === s ? '#2D2D2D' : '#6B6459' }}
            >
              {s === 'personal' ? 'Personal' : 'Nuestra'}
            </button>
          ))}
        </div>

        {/* Target currency */}
        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#6B6459' }}>Moneda del objetivo</p>
        <div className="flex rounded-2xl overflow-hidden mb-4 p-1 gap-1" style={{ background: '#ECE5DC' }}>
          {(['ARS', 'USD'] as const).map((cur) => (
            <button
              key={cur}
              onClick={() => setTargetCurrency(cur)}
              className="flex-1 py-1.5 text-xs font-bold rounded-xl transition-colors"
              style={{ background: targetCurrency === cur ? '#FFFFFF' : 'transparent', color: targetCurrency === cur ? '#2D2D2D' : '#6B6459' }}
            >
              {cur === 'ARS' ? '$ ARS' : 'USD'}
            </button>
          ))}
        </div>

        {/* Target amount */}
        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#6B6459' }}>
          Monto objetivo ({targetCurrency})
        </p>
        <MoneyInput
          value={targetAmount ? parseInt(targetAmount.replace(/\D/g, ''), 10) || 0 : 0}
          onChange={(n) => setTargetAmount(n ? String(n) : '')}
          placeholder={targetCurrency === 'ARS' ? 'Ej: 500.000' : 'Ej: 2.000'}
          className="w-full rounded-2xl px-4 py-3 text-lg font-bold mb-4 outline-none border-2 transition-colors"
          style={{ background: '#F9F5F0', color: '#2D2D2D', borderColor: targetAmount ? '#7EC8A4' : '#ECE5DC' }}
        />

        {/* Deadline */}
        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#6B6459' }}>Fecha límite</p>
        <input
          type="date"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          className="w-full rounded-2xl px-4 py-3 text-base font-semibold mb-6 outline-none border-2 transition-colors"
          style={{ background: '#F9F5F0', color: '#2D2D2D', borderColor: deadline ? '#7EC8A4' : '#ECE5DC' }}
        />

        <PrimaryButton
          onClick={save}
          disabled={!name || !targetAmount || !deadline}
          loading={saving}
          className="w-full py-4"
        >
          {saving ? 'Guardando…' : 'Guardar'}
        </PrimaryButton>
      </div>
    </div>
  );
}

function monthsUntil(deadline: string): number {
  const now = new Date();
  const d = new Date(deadline);
  return (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth());
}

function onTrackTag(
  goal: Goal,
  arsPerUsd: number,
  inflatedTarget: (amount: number, months: number) => number,
): { label: string; ok: boolean } {
  const now = new Date();
  const created = new Date(goal.created_at ?? now);
  const deadline = new Date(goal.deadline);

  let targetArs =
    goal.target_currency === 'USD'
      ? usdToArs(goal.target_amount, arsPerUsd)
      : goal.target_amount;

  // Adjust ARS target by expected inflation when deadline is > 3 months away
  if (goal.target_currency === 'ARS') {
    const remaining = monthsUntil(goal.deadline);
    if (remaining > 3) {
      targetArs = inflatedTarget(goal.target_amount, remaining);
    }
  }

  const pct = targetArs > 0 ? goal.current_amount / targetArs : 0;
  const totalDays = Math.max(1, (deadline.getTime() - created.getTime()) / 86400000);
  const elapsed = Math.max(0, (now.getTime() - created.getTime()) / 86400000);
  const expectedPct = elapsed / totalDays;

  return pct >= expectedPct ? { label: 'En camino', ok: true } : { label: 'Atrasado', ok: false };
}

export default function MetasClient({ profile }: { profile: Profile }) {
  const supabase = createClient();
  const qc = useQueryClient();
  const router = useRouter();
  const { arsPerUsd, format } = useFx();
  const { inflatedTarget, latestMonthlyPct, latestMonth } = useInflation();
  const [fabOpen, setFabOpen] = useState(false);
  const [fabType, setFabType] = useState<'expense' | 'income'>('expense');
  const [goalSheetOpen, setGoalSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);
  const [tab, setTab] = useState<'personal' | 'household'>('personal');

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
      const { data } = await supabase.from('accounts').select('id, name, type').eq('household_id', profile.household_id).eq('archived', false).order('name');
      return data ?? [];
    },
  });

  const { data: goals = [] } = useQuery<Goal[]>({
    queryKey: ['goals', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('goals')
        .select('*')
        .eq('household_id', profile.household_id)
        .eq('archived', false)
        .order('created_at', { ascending: false });
      return (data ?? []) as Goal[];
    },
  });

  const monthPrefix = monthKey();
  const { data: contribThisMonth = [] } = useQuery({
    queryKey: ['contrib-month', profile.household_id, monthPrefix],
    queryFn: async () => {
      const { data } = await supabase
        .from('goal_contributions')
        .select('goal_id, occurred_on')
        .gte('occurred_on', `${monthPrefix}-01`);
      return data ?? [];
    },
  });
  const contributedGoalIds = new Set(contribThisMonth.map((c) => c.goal_id));

  const archiveMutation = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from('goals').update({ archived: true }).eq('id', id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  });

  function openNew() {
    setEditing(null);
    setGoalSheetOpen(true);
  }

  function openEdit(g: Goal) {
    setEditing(g);
    setGoalSheetOpen(true);
  }

  const filtered = goals.filter((g) => g.scope === tab);

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F9F5F0' }}>
      <header className="flex items-center justify-between px-5 pt-14 pb-4">
        <h1 className="text-2xl font-black" style={{ color: '#2D2D2D' }}>Metas</h1>
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
            style={{ background: tab === t ? '#FFFFFF' : 'transparent', color: tab === t ? '#2D2D2D' : '#6B6459' }}
          >
            {t === 'personal' ? 'Personal' : 'Nuestra'}
          </button>
        ))}
      </div>

      <div className="px-4 flex flex-col gap-3">
        {filtered.length === 0 ? (
          <EmptyState
            icon="🎯"
            title="Sin metas"
            subtitle="¿Qué querés ahorrar? Creá tu primera meta."
            action={{ label: 'Crear meta', onClick: openNew }}
          />
        ) : (
          filtered.map((g) => {
            const targetArs =
              g.target_currency === 'USD' ? usdToArs(g.target_amount, arsPerUsd) : g.target_amount;
            const pct = targetArs > 0 ? Math.min(g.current_amount / targetArs, 1) : 0;
            const tag = onTrackTag(g, arsPerUsd, inflatedTarget);
            const done = pct >= 1;

            const targetDisplay =
              g.target_currency === 'USD' ? formatUSD(g.target_amount) : formatARS(g.target_amount);
            const currentDisplay = format(g.current_amount);

            // Inflation-adjusted target for ARS goals with deadline > 3 months
            const remaining = monthsUntil(g.deadline);
            const showInflationAdjusted =
              g.target_currency === 'ARS' && remaining > 3 && latestMonthlyPct !== null;
            const adjustedTarget = showInflationAdjusted
              ? inflatedTarget(g.target_amount, remaining)
              : null;

            return (
              <div
                key={g.id}
                className="rounded-3xl p-5 cursor-pointer active:scale-[0.98] transition-transform"
                style={{ background: '#FFFFFF' }}
                onClick={() => router.push(`/metas/${g.id}`)}
              >
                <div className="flex items-center gap-4">
                  {/* Ring */}
                  <div className="relative flex-shrink-0">
                    <ProgressRing pct={pct} color={g.color || '#7EC8A4'} size={72} stroke={7} />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-2xl">{g.icon}</span>
                    </div>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-black text-base truncate" style={{ color: '#2D2D2D' }}>{g.name}</p>
                      {done ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#E4F2EA', color: '#5BA886' }}>
                          ¡Logrado! 🎉
                        </span>
                      ) : (
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{
                            background: tag.ok ? '#E4F2EA' : '#FFE7E2',
                            color: tag.ok ? '#5BA886' : '#FF7F6B',
                          }}
                        >
                          {tag.label}
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-semibold" style={{ color: '#6B6459' }}>
                      {currentDisplay} de {targetDisplay}
                    </p>
                    {showInflationAdjusted && adjustedTarget !== null && (
                      <p className="text-[10px]" style={{ color: '#6B6459', opacity: 0.65 }}>
                        Con inflación al vencimiento ≈ {formatARS(adjustedTarget)}
                        {latestMonth ? ` (dato ${latestMonth})` : ''}
                      </p>
                    )}
                    <p className="text-xs mt-0.5" style={{ color: '#6B6459' }}>
                      Vence {new Date(g.deadline).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                    {!done && new Date(g.deadline) > new Date() && !contributedGoalIds.has(g.id) && (
                      <p className="text-[11px] font-bold mt-1 inline-block px-2 py-0.5 rounded-full" style={{ background: '#FBF1D8', color: '#B8860B' }}>
                        💸 Aportá este mes
                      </p>
                    )}
                    {/* progress bar */}
                    <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: '#ECE5DC' }}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct * 100}%`, background: g.color || '#7EC8A4' }}
                      />
                    </div>
                    <p className="text-[10px] font-bold mt-0.5" style={{ color: g.color || '#7EC8A4' }}>
                      {Math.round(pct * 100)}%
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => openEdit(g)}
                      className="text-xs px-3 py-1.5 rounded-xl font-semibold"
                      style={{ background: '#F9F5F0', color: '#6B6459' }}
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => archiveMutation.mutate(g.id)}
                      className="text-xs px-3 py-1.5 rounded-xl font-semibold"
                      style={{ background: '#FFE7E2', color: '#FF7F6B' }}
                    >
                      Archivar
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <BottomNav onFab={(type) => { setFabType(type); setFabOpen(true); }} />

      <AddTransactionSheet
        open={fabOpen}
        initialType={fabType}
        onClose={() => setFabOpen(false)}
        householdId={profile.household_id}
        profileId={profile.id}
        categories={categories}
        accounts={accounts}
      />

      {goalSheetOpen && (
        <GoalSheet
          key={editing?.id ?? 'new'}
          open={goalSheetOpen}
          onClose={() => setGoalSheetOpen(false)}
          householdId={profile.household_id}
          profileId={profile.id}
          editing={editing}
        />
      )}
    </div>
  );
}
