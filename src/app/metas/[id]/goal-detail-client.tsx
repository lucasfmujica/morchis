'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { formatARS, formatUSD, usdToArs, arsToUsd, parseMoney } from '@/lib/format';
import { todayISO } from '@/lib/date';
import { MoneyInput } from '@/components/MoneyInput';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useFx } from '@/hooks/useFx';

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

interface Contribution {
  id: string;
  goal_id: string;
  profile_id: string;
  amount: number;
  occurred_on: string;
  note: string | null;
}

// ─── Confetti ────────────────────────────────────────────────────────────────

const CONFETTI_COLORS = ['#FF7F6B', '#7EC8A4', '#FFE7E2', '#E4F2EA', '#FDB863', '#6BAED6'];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  rotV: number;
  color: string;
  size: number;
  shape: 'rect' | 'circle';
}

function Confetti({ onDone }: { onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles: Particle[] = Array.from({ length: 120 }, () => ({
      x: Math.random() * canvas.width,
      y: -20,
      vx: (Math.random() - 0.5) * 6,
      vy: Math.random() * 4 + 2,
      rot: Math.random() * Math.PI * 2,
      rotV: (Math.random() - 0.5) * 0.2,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      size: Math.random() * 10 + 6,
      shape: Math.random() > 0.5 ? 'rect' : 'circle',
    }));

    let frame: number;
    let elapsed = 0;

    function draw() {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      elapsed++;
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.08; // gravity
        p.rot += p.rotV;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, 1 - elapsed / 120);
        if (p.shape === 'rect') {
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      if (elapsed < 150) {
        frame = requestAnimationFrame(draw);
      } else {
        onDone();
      }
    }

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [onDone]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-50 pointer-events-none"
      style={{ width: '100%', height: '100%' }}
    />
  );
}

// ─── Progress ring ────────────────────────────────────────────────────────────

function ProgressRing({ pct, color, size = 120, stroke = 10 }: { pct: number; color: string; size?: number; stroke?: number }) {
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
        style={{ transition: 'stroke-dasharray 0.8s ease' }}
      />
    </svg>
  );
}

// ─── Aportar sheet ────────────────────────────────────────────────────────────

function AportarSheet({
  goal,
  profileId,
  arsPerUsd,
  onClose,
  onSaved,
}: {
  goal: Goal;
  profileId: string;
  arsPerUsd: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const [amount, setAmount] = useState('');
  const [inputCurrency, setInputCurrency] = useState<'ARS' | 'USD'>(goal.target_currency);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const amountNum = parseMoney(amount);
  const amountArs = inputCurrency === 'USD' ? usdToArs(amountNum, arsPerUsd) : amountNum;

  async function save() {
    if (!amountNum) return;
    setSaving(true);

    const newCurrentAmount = goal.current_amount + amountArs;

    await supabase.from('goal_contributions').insert({
      goal_id: goal.id,
      profile_id: profileId,
      amount: amountArs,
      occurred_on: todayISO(),
      note: note || null,
    });

    await supabase.from('goals').update({ current_amount: newCurrentAmount }).eq('id', goal.id);

    setSaving(false);
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: 'rgba(45,45,45,0.4)' }} onClick={onClose}>
      <div
        className="w-full rounded-t-3xl p-6"
        style={{ background: '#FFFFFF', paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: '#ECE5DC' }} />
        <h2 className="text-lg font-black mb-1" style={{ color: '#2D2D2D' }}>Aportar a {goal.name}</h2>
        <p className="text-sm mb-5" style={{ color: '#6B6459' }}>
          Tenés {goal.target_currency === 'USD' ? formatUSD(arsToUsd(goal.current_amount, arsPerUsd)) : formatARS(goal.current_amount)} de{' '}
          {goal.target_currency === 'USD' ? formatUSD(goal.target_amount) : formatARS(goal.target_amount)}
        </p>

        {/* Input currency toggle */}
        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#6B6459' }}>Ingresá en</p>
        <div className="flex rounded-2xl overflow-hidden mb-4 p-1 gap-1" style={{ background: '#ECE5DC' }}>
          {(['ARS', 'USD'] as const).map((cur) => (
            <button
              key={cur}
              onClick={() => setInputCurrency(cur)}
              className="flex-1 py-1.5 text-xs font-bold rounded-xl transition-colors"
              style={{ background: inputCurrency === cur ? '#FFFFFF' : 'transparent', color: inputCurrency === cur ? '#2D2D2D' : '#6B6459' }}
            >
              {cur === 'ARS' ? '$ ARS' : 'USD'}
            </button>
          ))}
        </div>

        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#6B6459' }}>Monto</p>
        <MoneyInput
          value={parseMoney(amount)}
          onChange={(n) => setAmount(n ? String(n) : '')}
          placeholder={inputCurrency === 'ARS' ? 'Ej: 50.000' : 'Ej: 100'}
          className="w-full rounded-2xl px-4 py-3 text-lg font-bold mb-2 outline-none border-2 transition-colors"
          style={{ background: '#F9F5F0', color: '#2D2D2D', borderColor: amount ? '#7EC8A4' : '#ECE5DC' }}
          autoFocus
        />
        {inputCurrency === 'USD' && amountNum > 0 && (
          <p className="text-xs mb-3 font-semibold" style={{ color: '#6B6459' }}>
            ≈ {formatARS(amountArs)} al tipo de cambio blue
          </p>
        )}

        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#6B6459' }}>Nota (opcional)</p>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ej: Sueldo de mayo"
          className="w-full rounded-2xl px-4 py-3 text-base font-semibold mb-5 outline-none border-2 transition-colors"
          style={{ background: '#F9F5F0', color: '#2D2D2D', borderColor: note ? '#7EC8A4' : '#ECE5DC' }}
        />

        <PrimaryButton
          onClick={save}
          disabled={!amountNum}
          loading={saving}
          className="w-full py-4"
        >
          {saving ? 'Guardando…' : 'Aportar'}
        </PrimaryButton>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function GoalDetailClient({ goalId, profile }: { goalId: string; profile: Profile }) {
  const supabase = createClient();
  const qc = useQueryClient();
  const router = useRouter();
  const { arsPerUsd, format, secondary } = useFx();
  const [aportarOpen, setAportarOpen] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const prevDoneRef = useRef(false);

  const { data: goal } = useQuery<Goal | null>({
    queryKey: ['goal', goalId],
    queryFn: async () => {
      const { data } = await supabase.from('goals').select('*').eq('id', goalId).single();
      return (data as Goal) ?? null;
    },
  });

  const { data: contributions = [] } = useQuery<Contribution[]>({
    queryKey: ['goal-contributions', goalId],
    queryFn: async () => {
      const { data } = await supabase
        .from('goal_contributions')
        .select('*')
        .eq('goal_id', goalId)
        .order('occurred_on', { ascending: false });
      return (data ?? []) as Contribution[];
    },
  });

  // Trigger confetti when goal just became complete
  useEffect(() => {
    if (!goal) return;
    const targetArs = goal.target_currency === 'USD' ? usdToArs(goal.target_amount, arsPerUsd) : goal.target_amount;
    const done = targetArs > 0 && goal.current_amount >= targetArs;
    if (done && !prevDoneRef.current) {
      setShowConfetti(true);
    }
    prevDoneRef.current = done;
  }, [goal, arsPerUsd]);

  function handleSaved() {
    qc.invalidateQueries({ queryKey: ['goal', goalId] });
    qc.invalidateQueries({ queryKey: ['goal-contributions', goalId] });
    qc.invalidateQueries({ queryKey: ['goals'] });
    qc.invalidateQueries({ queryKey: ['contrib-month'] });
  }

  if (!goal) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#F9F5F0' }}>
        <p style={{ color: '#6B6459' }}>Cargando…</p>
      </div>
    );
  }

  const targetArs = goal.target_currency === 'USD' ? usdToArs(goal.target_amount, arsPerUsd) : goal.target_amount;
  const pct = targetArs > 0 ? Math.min(goal.current_amount / targetArs, 1) : 0;
  const done = pct >= 1;

  const targetDisplay = goal.target_currency === 'USD' ? formatUSD(goal.target_amount) : formatARS(goal.target_amount);
  const currentArsDisplay = format(goal.current_amount);
  const currentSecondary = secondary(goal.current_amount);

  // On-track logic
  const now = new Date();
  const created = new Date(goal.created_at ?? now);
  const deadline = new Date(goal.deadline);
  const totalDays = Math.max(1, (deadline.getTime() - created.getTime()) / 86400000);
  const elapsed = Math.max(0, (now.getTime() - created.getTime()) / 86400000);
  const expectedPct = elapsed / totalDays;
  const onTrack = pct >= expectedPct;

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F9F5F0' }}>
      {showConfetti && <Confetti onDone={() => setShowConfetti(false)} />}

      {/* Header */}
      <header className="flex items-center gap-3 px-5 pt-14 pb-4">
        <button
          onClick={() => router.back()}
          className="w-9 h-9 rounded-full flex items-center justify-center text-xl font-bold"
          style={{ background: '#FFFFFF', color: '#2D2D2D' }}
        >
          ‹
        </button>
        <h1 className="text-xl font-black truncate" style={{ color: '#2D2D2D' }}>{goal.name}</h1>
      </header>

      {/* Hero card */}
      <div className="mx-4 rounded-3xl p-6 mb-4" style={{ background: '#FFFFFF' }}>
        <div className="flex items-center gap-6">
          {/* Big ring */}
          <div className="relative flex-shrink-0">
            <ProgressRing pct={pct} color={goal.color || '#7EC8A4'} size={120} stroke={10} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl">{goal.icon}</span>
              <span className="text-xs font-black mt-0.5" style={{ color: goal.color || '#7EC8A4' }}>
                {Math.round(pct * 100)}%
              </span>
            </div>
          </div>

          <div className="flex-1">
            {done ? (
              <div className="mb-2 inline-block px-3 py-1 rounded-full text-xs font-black" style={{ background: '#E4F2EA', color: '#5BA886' }}>
                ¡Meta cumplida! 🎉
              </div>
            ) : (
              <div
                className="mb-2 inline-block px-3 py-1 rounded-full text-xs font-black"
                style={{ background: onTrack ? '#E4F2EA' : '#FFE7E2', color: onTrack ? '#5BA886' : '#FF7F6B' }}
              >
                {onTrack ? 'En camino ✓' : 'Atrasado ⚠'}
              </div>
            )}

            <p className="text-2xl font-black tabular-nums" style={{ color: '#2D2D2D' }}>{currentArsDisplay}</p>
            <p className="text-xs font-semibold" style={{ color: '#6B6459' }}>{currentSecondary}</p>
            <p className="text-sm mt-1 font-semibold" style={{ color: '#6B6459' }}>
              de {targetDisplay}
            </p>
            <p className="text-xs mt-0.5" style={{ color: '#6B6459' }}>
              Vence {deadline.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-4 h-2.5 rounded-full overflow-hidden" style={{ background: '#ECE5DC' }}>
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${pct * 100}%`, background: goal.color || '#7EC8A4' }}
          />
        </div>

        {/* Stats row */}
        {!done && targetArs > 0 && (
          <div className="flex justify-between mt-3">
            <div>
              <p className="text-xs" style={{ color: '#6B6459' }}>Falta</p>
              <p className="text-sm font-black" style={{ color: '#2D2D2D' }}>
                {format(Math.max(0, targetArs - goal.current_amount))}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs" style={{ color: '#6B6459' }}>Ritmo esperado</p>
              <p className="text-sm font-black" style={{ color: '#2D2D2D' }}>
                {Math.round(expectedPct * 100)}%
              </p>
            </div>
          </div>
        )}

        {/* Aportar button */}
        {!done && (
          <button
            onClick={() => setAportarOpen(true)}
            className="mt-4 w-full py-3.5 rounded-2xl font-black text-white text-base"
            style={{ background: goal.color || '#7EC8A4' }}
          >
            + Aportar
          </button>
        )}
        {done && (
          <div className="mt-4 text-center">
            <p className="text-sm font-bold" style={{ color: '#5BA886' }}>
              🎊 ¡Felicitaciones, Morchis! Cumplieron la meta.
            </p>
          </div>
        )}
      </div>

      {/* Contribution history */}
      <div className="px-4">
        <h2 className="text-base font-black mb-3" style={{ color: '#2D2D2D' }}>Historial de aportes</h2>
        {contributions.length === 0 ? (
          <div className="rounded-3xl p-5 text-center" style={{ background: '#FFFFFF' }}>
            <p className="text-sm" style={{ color: '#6B6459' }}>Todavía no hay aportes. ¡Empezá ahora!</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {contributions.map((c) => (
              <div key={c.id} className="rounded-2xl px-4 py-3 flex items-center justify-between" style={{ background: '#FFFFFF' }}>
                <div>
                  <p className="text-sm font-bold" style={{ color: '#2D2D2D' }}>
                    {new Date(c.occurred_on).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                  {c.note && (
                    <p className="text-xs" style={{ color: '#6B6459' }}>{c.note}</p>
                  )}
                </div>
                <p className="text-sm font-black tabular-nums" style={{ color: goal.color || '#7EC8A4' }}>
                  +{format(c.amount)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {aportarOpen && (
        <AportarSheet
          goal={goal}
          profileId={profile.id}
          arsPerUsd={arsPerUsd}
          onClose={() => setAportarOpen(false)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
