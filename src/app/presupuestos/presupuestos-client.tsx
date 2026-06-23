'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { useFx } from '@/hooks/useFx';
import { useEnvelope, type EnvelopeCategory, type EnvelopeDetailTx, type UseEnvelopeResult, type TargetInfo, type AutoAssignStrategy } from '@/hooks/useEnvelope';
import { useCoupleBalance } from '@/hooks/useCouple';
import { BottomNav } from '@/components/BottomNav';
import { AddTransactionSheet } from '@/components/AddTransactionSheet';
import { MoneyInput } from '@/components/MoneyInput';
import { monthKey } from '@/lib/date';

interface Profile {
  id: string;
  household_id: string;
  nickname: string | null;
  display_name: string | null;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// es-AR number for the table cells — no symbol, so the columns read clean.
// `|| 0` collapses negative zero (Math.round(-0.2) === -0) so we never show "-0".
function fmtCell(n: number): string {
  return (Math.round(n) || 0).toLocaleString('es-AR');
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

function fmtGoalDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-AR', { month: 'short', year: 'numeric' });
}

// Available colour with goal awareness. `needed` is how much MORE you still
// have to assign this month to be on track for the category's goal — already
// computed per target type by the hook (refill = top up to X; set_aside = assign
// a fresh X). Driving the colour off `needed` (not `available < target`) is what
// makes a monthly spending budget read right: once you've assigned your full
// "Sumar cada mes" amount, the envelope is green even after you've spent most of
// it — it's not "below target".
//   red    = overspent (negative)
//   yellow = still owe an assignment toward this month's goal
//   green  = funded / on track
//   grey   = zero with nothing pending
function availColor(available: number, needed: number): string {
  if (available < 0) return '#E25749';
  if (needed > 0) return '#C79A2B';
  if (available > 0) return '#1F8A68';
  return '#8C968F';
}

// The available "pill": a solid green capsule when funded (the happy state
// pops), a soft tint for the warning/zero states.
function availPill(available: number, needed: number): { bg: string; fg: string } {
  const c = availColor(available, needed);
  if (c === '#1F8A68') return { bg: '#1F8A68', fg: '#FFFFFF' }; // funded → filled green
  const bg = c === '#E25749' ? '#FFE5E0' : c === '#C79A2B' ? '#FBF0D6' : '#E5EBE8';
  return { bg, fg: c };
}

// A plain right-aligned money field (no boxy "tag") that commits on blur. The
// parent remounts it via `key` when the stored value changes externally.
function MoneyField({
  value,
  onCommit,
  className,
  style,
  placeholder,
}: {
  value: number;
  onCommit: (n: number) => void;
  className?: string;
  style?: React.CSSProperties;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <span onBlur={() => { if (draft !== value) onCommit(draft); }}>
      <MoneyInput value={draft} onChange={setDraft} placeholder={placeholder} className={className} style={style} />
    </span>
  );
}

interface RowData { assigned: number; activity: number; available: number }

function CategoryDetailSheet({
  category,
  row,
  target,
  targetInfo,
  suggested,
  month,
  lastMonth,
  transactions,
  otherCategories,
  editable,
  isFeatured,
  isHidden,
  format,
  onClose,
  onAssign,
  onSetTarget,
  onToggleFeatured,
  onToggleHidden,
  onMove,
  onRenameCategory,
  groups,
  onMoveToGroup,
}: {
  category: EnvelopeCategory;
  row: RowData;
  target: number;
  targetInfo: TargetInfo | undefined;
  suggested: number;
  month: string;
  lastMonth: { assigned: number; activity: number };
  transactions: EnvelopeDetailTx[];
  otherCategories: EnvelopeCategory[];
  editable: boolean;
  isFeatured: boolean;
  isHidden: boolean;
  format: (ars: number) => string;
  onClose: () => void;
  onAssign: (n: number) => void;
  onSetTarget: (amount: number, cadence: 'monthly' | 'by_date' | 'weekly', date: string | null, targetType: 'refill' | 'set_aside') => void;
  onToggleFeatured: () => void;
  onToggleHidden: () => void;
  onMove: (toCategoryId: string, amount: number) => void;
  onRenameCategory: (name: string, icon: string) => void;
  groups: EnvelopeCategory[];
  onMoveToGroup: (groupId: string | null) => void;
}) {
  const [moveTo, setMoveTo] = useState('');
  const [moveAmt, setMoveAmt] = useState(0);
  const [tMode, setTMode] = useState<'monthly' | 'by_date' | 'weekly'>(targetInfo?.cadence ?? 'monthly');
  // Default new budgets to a monthly spending budget (set_aside): for everyday
  // categories that's what people mean by "tengo $X por mes para esto" — refill
  // ("keep $X always available") is the niche case, so it's the opt-in.
  const [tType, setTType] = useState<'refill' | 'set_aside'>(targetInfo?.targetType ?? 'set_aside');
  const [tAmt, setTAmt] = useState(targetInfo?.totalArs ?? 0);
  const [tDate, setTDate] = useState(targetInfo?.targetDate ?? '');
  const [editingName, setEditingName] = useState(false);
  const [cName, setCName] = useState(category.name);
  const [cIcon, setCIcon] = useState(category.icon);
  // How much more to assign this month to be on track — already computed per
  // target type by the hook (refill tops `available` up to X; set_aside assigns
  // a fresh X regardless of what's left). Use it for the pill colour and the
  // quick "fund the goal" button so a monthly budget doesn't ask you to re-fund
  // what you already spent.
  const needed = targetInfo?.neededThisMonth ?? 0;
  const toTarget = needed;
  // Balance breakdown (YNAB style): what carried over vs what moved this month.
  const carryover = row.available - row.assigned + row.activity;
  const prevLabel = monthLabel(shiftMonth(month, -1));
  const curLabel = monthLabel(month);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center" style={{ background: 'rgba(20,28,24,0.45)' }} onClick={onClose}>
      <div
        className="w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl p-6 max-h-[88vh] overflow-y-auto"
        style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)', paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: '#E5EBE8' }} />
        <div className="flex items-center gap-2 mb-4">
          <span className="text-2xl">{category.icon}</span>
          <h2 className="text-lg font-black flex-1 min-w-0 truncate" style={{ color: '#18211D' }}>{category.name}</h2>
          {editable && (
            <button onClick={() => { setCName(category.name); setCIcon(category.icon); setEditingName((v) => !v); }} className="text-xs font-bold px-2 py-1 rounded-lg shrink-0" style={{ background: '#F1F5F3', color: '#5B6660' }}>✏️ Editar</button>
          )}
        </div>
        {editingName && editable && (
          <div className="flex gap-2 mb-4">
            <input value={cIcon} onChange={(e) => setCIcon(e.target.value)} maxLength={2} className="w-12 text-center rounded-xl border-2 outline-none py-2 text-lg" style={{ borderColor: '#E5EBE8', background: '#F1F5F3' }} />
            <input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="Nombre" className="flex-1 rounded-xl border-2 outline-none px-3 text-sm font-bold" style={{ borderColor: '#E5EBE8', background: '#F1F5F3', color: '#18211D' }} />
            <button onClick={() => { if (cName.trim()) { onRenameCategory(cName.trim(), cIcon || category.icon); setEditingName(false); } }} className="px-4 rounded-xl text-sm font-bold text-white" style={{ background: '#2FA37C' }}>OK</button>
          </div>
        )}
        {editingName && editable && groups.length > 0 && (
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs font-bold shrink-0" style={{ color: '#5B6660' }}>Grupo</span>
            <select
              value={category.parent_id ?? ''}
              onChange={(e) => onMoveToGroup(e.target.value || null)}
              className="flex-1 rounded-xl border-2 outline-none px-3 py-2 text-sm font-bold bg-white"
              style={{ borderColor: '#E5EBE8', color: '#18211D' }}
            >
              <option value="">Sin grupo</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.icon} {g.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Balance breakdown (YNAB style) */}
        <p className="text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: '#5B6660' }}>Balance</p>
        <div className="rounded-2xl overflow-hidden mb-4" style={{ background: '#F1F5F3' }}>
          {[
            { l: `Desde ${prevLabel}`, v: format(carryover) },
            { l: `Asignado en ${curLabel}`, v: format(row.assigned) },
            { l: `Actividad en ${curLabel}`, v: format(-row.activity) },
          ].map((r, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3" style={{ borderTop: i > 0 ? '1px solid #E5EBE8' : 'none' }}>
              <span className="text-sm" style={{ color: '#5B6660' }}>{r.l}</span>
              <span className="text-sm font-bold tabular-nums" style={{ color: '#18211D' }}>{r.v}</span>
            </div>
          ))}
          <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: '1px solid #E5EBE8' }}>
            <span className="text-sm font-bold" style={{ color: '#18211D' }}>Disponible</span>
            <span className="text-sm font-black px-2.5 py-1 rounded-full tabular-nums" style={{ background: availPill(row.available, needed).bg, color: availPill(row.available, needed).fg }}>{format(row.available)}</span>
          </div>
        </div>

        {/* Goal/target status */}
        {targetInfo && (
          <div className="rounded-2xl p-4 mb-4 text-center" style={{ background: targetInfo.neededThisMonth <= 0 ? '#DDF0E8' : '#F1F5F3' }}>
            {targetInfo.cadence === 'by_date' ? (
              row.available >= targetInfo.totalArs && targetInfo.totalArs > 0 ? (
                <p className="text-sm font-bold" style={{ color: '#1F8A68' }}>✓ ¡Meta cumplida!</p>
              ) : (
                <p className="text-sm" style={{ color: '#5B6660' }}>
                  Faltan <b>{format(targetInfo.totalArs - row.available)}</b>{targetInfo.targetDate ? ` para ${fmtGoalDate(targetInfo.targetDate)}` : ''} · necesitás <b style={{ color: '#C79A2B' }}>{format(targetInfo.neededThisMonth)}</b> este mes
                </p>
              )
            ) : (
              <p className="text-sm" style={{ color: '#5B6660' }}>
                {targetInfo.targetType === 'set_aside'
                  ? (targetInfo.cadence === 'weekly' ? 'Presupuesto semanal ' : 'Presupuesto mensual ')
                  : (targetInfo.cadence === 'weekly' ? 'Saldo fijo semanal ' : 'Saldo fijo mensual ')}{format(targetInfo.totalArs)}
                {targetInfo.neededThisMonth > 0
                  ? <> · {targetInfo.targetType === 'set_aside' ? 'falta asignar' : 'faltan'} <b style={{ color: '#C79A2B' }}>{format(targetInfo.neededThisMonth)}</b> este mes</>
                  : <span style={{ color: '#1F8A68' }}> · al día este mes ✓</span>}
              </p>
            )}
          </div>
        )}

        {editable && (
          <>
            {/* Assigned editor */}
            <p className="text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: '#5B6660' }}>Asignado este mes</p>
            <MoneyField
              key={`a-${row.assigned}`}
              value={row.assigned}
              onCommit={onAssign}
              placeholder="0"
              className="w-full rounded-2xl px-4 py-3 text-lg font-bold mb-3 outline-none border-2"
              style={{ background: '#F1F5F3', color: '#18211D', borderColor: '#E5EBE8' }}
            />

            {/* Quick actions */}
            <div className="flex flex-wrap gap-2 mb-4">
              {row.available < 0 && (
                <button
                  onClick={() => onAssign(row.assigned - row.available)}
                  className="text-xs font-bold px-3 py-2 rounded-xl"
                  style={{ background: '#FFE5E0', color: '#E25749' }}
                >
                  Cubrir sobregiro (+{format(-row.available)})
                </button>
              )}
              {target > 0 && toTarget > 0 && (
                <button
                  onClick={() => onAssign(row.assigned + toTarget)}
                  className="text-xs font-bold px-3 py-2 rounded-xl"
                  style={{ background: '#FDF1D8', color: '#B8860B' }}
                >
                  Asignar para la meta (+{format(toTarget)})
                </button>
              )}
              {lastMonth.assigned > 0 && (
                <button
                  onClick={() => onAssign(lastMonth.assigned)}
                  className="text-xs font-bold px-3 py-2 rounded-xl"
                  style={{ background: '#EAF6F1', color: '#1F8A68' }}
                >
                  Asignaste el mes pasado {format(lastMonth.assigned)}
                </button>
              )}
              {lastMonth.activity > 0 && (
                <button
                  onClick={() => onAssign(lastMonth.activity)}
                  className="text-xs font-bold px-3 py-2 rounded-xl"
                  style={{ background: '#F1F5F3', color: '#5B6660' }}
                >
                  Gastaste el mes pasado {format(lastMonth.activity)}
                </button>
              )}
            </div>

            {/* Target — monthly amount or a by-date savings goal */}
            <p className="text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: '#5B6660' }}>Meta</p>
            <div className="flex rounded-xl overflow-hidden mb-2 p-1 gap-1" style={{ background: '#E5EBE8' }}>
              {([{ k: 'monthly', l: 'Mensual' }, { k: 'weekly', l: 'Semanal' }, { k: 'by_date', l: 'Por fecha' }] as const).map((o) => (
                <button key={o.k} onClick={() => setTMode(o.k)} className="flex-1 py-1.5 text-xs font-bold rounded-lg" style={{ background: tMode === o.k ? '#FFFFFF' : 'transparent', color: tMode === o.k ? '#18211D' : '#5B6660' }}>{o.l}</button>
              ))}
            </div>
            {tMode !== 'by_date' && (
              <div className="flex rounded-xl overflow-hidden mb-2 p-1 gap-1" style={{ background: '#E5EBE8' }}>
                {([{ k: 'set_aside', l: 'Presupuesto del mes' }, { k: 'refill', l: 'Saldo fijo' }] as const).map((o) => (
                  <button key={o.k} onClick={() => setTType(o.k)} className="flex-1 py-1.5 text-[11px] font-bold rounded-lg" style={{ background: tType === o.k ? '#FFFFFF' : 'transparent', color: tType === o.k ? '#18211D' : '#5B6660' }}>{o.l}</button>
                ))}
              </div>
            )}
            <p className="text-[11px] mb-1.5" style={{ color: '#5B6660' }}>
              {tMode === 'by_date'
                ? 'Total a juntar para una fecha (meta de ahorro).'
                : tType === 'set_aside'
                  ? `Cuánto querés gastar por ${tMode === 'weekly' ? 'semana' : 'mes'} acá. Cada ${tMode === 'weekly' ? 'semana' : 'mes'} arranca de nuevo con este monto fresco; lo que no gastes se suma al siguiente. Ideal para comer afuera, super, nafta.`
                  : `Mantené siempre este monto disponible. Cuando gastás, lo reponés hasta volver a este monto (no se suma cada ${tMode === 'weekly' ? 'semana' : 'mes'}). Ideal para un colchón fijo.`}
            </p>
            {suggested > 0 && tMode === 'monthly' && (
              <button onClick={() => setTAmt(suggested)} className="text-xs font-bold px-3 py-2 rounded-xl mb-2" style={{ background: '#E9F1FD', color: '#4E84E0' }}>
                ✨ Sugerido {format(suggested)} (según tu gasto)
              </button>
            )}
            <MoneyInput
              value={tAmt}
              onChange={setTAmt}
              placeholder="0"
              className="w-full rounded-2xl px-4 py-3 text-base font-bold mb-2 outline-none border-2"
              style={{ background: '#F1F5F3', color: '#18211D', borderColor: '#E5EBE8' }}
            />
            {tMode === 'by_date' && (
              <input
                type="date"
                value={tDate}
                onChange={(e) => setTDate(e.target.value)}
                className="w-full rounded-2xl px-4 py-3 text-base font-bold mb-2 outline-none border-2"
                style={{ background: '#F1F5F3', color: '#18211D', borderColor: '#E5EBE8' }}
              />
            )}
            <button onClick={() => onSetTarget(tAmt, tMode, tMode === 'by_date' ? (tDate || null) : null, tType)} className="w-full py-2.5 rounded-xl text-sm font-bold text-white mb-4" style={{ background: '#2FA37C' }}>
              Guardar meta
            </button>

            {/* Feature this category as the Home goal */}
            <button onClick={onToggleFeatured} className="w-full py-2.5 rounded-xl text-sm font-bold mb-3" style={{ background: isFeatured ? '#DDF0E8' : '#F1F5F3', color: isFeatured ? '#1F8A68' : '#5B6660' }}>
              {isFeatured ? '📌 Destacada en Home' : '📌 Destacar en Home'}
            </button>

            {/* Hide this category from the list (one you won't assign to) */}
            <button onClick={onToggleHidden} className="w-full py-2.5 rounded-xl text-sm font-bold mb-4" style={{ background: isHidden ? '#FCEBE8' : '#F1F5F3', color: isHidden ? '#E25749' : '#5B6660' }}>
              {isHidden ? '👁 Mostrar esta categoría' : '🙈 Ocultar esta categoría'}
            </button>

            {/* Move money to another category */}
            <p className="text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: '#5B6660' }}>Mover plata a otra categoría</p>
            <div className="flex flex-col gap-2 mb-5">
              <select
                value={moveTo}
                onChange={(e) => setMoveTo(e.target.value)}
                className="w-full min-w-0 rounded-xl px-3 py-2 text-sm outline-none border"
                style={{ background: '#F1F5F3', color: '#18211D', borderColor: '#E5EBE8' }}
              >
                <option value="">Elegí una categoría…</option>
                {otherCategories.map((c) => (
                  <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                ))}
              </select>
              <div className="flex gap-2">
                <MoneyInput
                  value={moveAmt}
                  onChange={setMoveAmt}
                  placeholder="Monto"
                  className="flex-1 min-w-0 rounded-xl px-3 py-2 text-sm font-bold outline-none border text-right"
                  style={{ background: '#F1F5F3', color: '#18211D', borderColor: '#E5EBE8' }}
                />
                <button
                  onClick={() => { if (moveTo && moveAmt > 0) { onMove(moveTo, moveAmt); setMoveTo(''); setMoveAmt(0); } }}
                  disabled={!moveTo || moveAmt <= 0}
                  className="shrink-0 px-4 py-2 rounded-xl text-sm font-bold text-white"
                  style={{ background: !moveTo || moveAmt <= 0 ? '#B0BAB4' : '#2FA37C' }}
                >
                  Mover
                </button>
              </div>
            </div>
          </>
        )}

        {/* This month's transactions */}
        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#5B6660' }}>
          Movimientos del mes · {transactions.length}
        </p>
        {transactions.length === 0 ? (
          <p className="text-sm py-4 text-center" style={{ color: '#5B6660' }}>Sin gastos este mes.</p>
        ) : (
          <div className="rounded-2xl overflow-hidden" style={{ background: '#F1F5F3' }}>
            {transactions.map((t, i) => (
              <div key={t.id} className="flex items-center gap-3 px-4 py-3" style={{ borderTop: i > 0 ? '1px solid #E5EBE8' : 'none' }}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: '#18211D' }}>{t.merchant || category.name}</p>
                  <p className="text-xs" style={{ color: '#5B6660' }}>
                    {fmtDate(t.occurred_on)}{t.shared ? ' · compartido' : ''}{t.fixed ? ' · 📌 fijo' : ''}
                  </p>
                </div>
                <p className="text-base font-black" style={{ color: '#FF6F61', fontVariantNumeric: 'tabular-nums' }}>-{format(t.amountArs)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const CATEGORY_ICONS = [
  '🛒', '🍕', '☕', '🍷', '🚇', '🚗', '💊', '🏥', '🎭', '📚', '✈️', '🏠',
  '💼', '💵', '📱', '💻', '👗', '💅', '🎮', '🎁', '🐾', '🌿', '⚽', '💡',
];

function NewCategorySheet({ groups, onClose, onCreate }: { groups: EnvelopeCategory[]; onClose: () => void; onCreate: (name: string, icon: string, isGroup: boolean, parentId: string | null) => void }) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('🏷️');
  const [isGroup, setIsGroup] = useState(false);
  const [parentId, setParentId] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center" style={{ background: 'rgba(20,28,24,0.45)' }} onClick={onClose}>
      <div
        className="w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl p-6"
        style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)', paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: '#E5EBE8' }} />
        <h2 className="text-lg font-black mb-4" style={{ color: '#18211D' }}>Nueva categoría</h2>

        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#5B6660' }}>Nombre</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej: Gimnasio"
          autoFocus
          className="w-full rounded-2xl px-4 py-3 text-base font-bold mb-4 outline-none border-2"
          style={{ background: '#F1F5F3', color: '#18211D', borderColor: name ? '#2FA37C' : '#E5EBE8' }}
        />

        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#5B6660' }}>Ícono</p>
        <div className="flex flex-wrap gap-2 mb-5">
          {CATEGORY_ICONS.map((ic) => (
            <button
              key={ic}
              onClick={() => setIcon(ic)}
              className="w-10 h-10 rounded-xl text-xl flex items-center justify-center"
              style={{ background: icon === ic ? '#2FA37C' : '#F1F5F3', outline: icon === ic ? '2px solid #1F8A68' : 'none' }}
            >
              {ic}
            </button>
          ))}
        </div>

        <button
          onClick={() => setIsGroup((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 rounded-2xl mb-4 border-2"
          style={{ background: isGroup ? '#DDF0E8' : '#F1F5F3', borderColor: isGroup ? '#2FA37C' : '#E5EBE8' }}
        >
          <span className="text-sm font-bold" style={{ color: '#18211D' }}>📂 Es un grupo (encabezado)</span>
          <span className="text-xs font-bold" style={{ color: isGroup ? '#1F8A68' : '#5B6660' }}>{isGroup ? 'Sí' : 'No'}</span>
        </button>
        <p className="text-[11px] mb-4 -mt-2" style={{ color: '#5B6660' }}>Un grupo agrupa categorías (no se le asigna plata).</p>

        {!isGroup && groups.length > 0 && (
          <>
            <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#5B6660' }}>Grupo</p>
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="w-full rounded-2xl border-2 outline-none px-4 py-3 text-sm font-bold bg-white mb-5"
              style={{ borderColor: '#E5EBE8', color: '#18211D' }}
            >
              <option value="">Sin grupo</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.icon} {g.name}</option>
              ))}
            </select>
          </>
        )}

        <button
          onClick={() => { if (name.trim()) { onCreate(name.trim(), icon, isGroup, isGroup ? null : (parentId || null)); onClose(); } }}
          disabled={!name.trim()}
          className="w-full py-4 rounded-2xl font-bold text-white"
          style={{ background: name.trim() ? '#2FA37C' : '#B0BAB4' }}
        >
          {isGroup ? 'Crear grupo' : 'Crear categoría'}
        </button>
      </div>
    </div>
  );
}

function NewViewSheet({
  categories, savedViews, onClose, onCreate, onDelete,
}: {
  categories: EnvelopeCategory[];
  savedViews: { id: string; name: string; category_ids: string[] }[];
  onClose: () => void;
  onCreate: (name: string, categoryIds: string[]) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center" style={{ background: 'rgba(20,28,24,0.45)' }} onClick={onClose}>
      <div className="w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl p-6 max-h-[88vh] overflow-y-auto" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)', paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }} onClick={(e) => e.stopPropagation()}>
        <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: '#E5EBE8' }} />
        <h2 className="text-lg font-black mb-4" style={{ color: '#18211D' }}>Vistas guardadas</h2>

        {savedViews.length > 0 && (
          <div className="rounded-2xl overflow-hidden mb-5" style={{ background: '#F1F5F3' }}>
            {savedViews.map((v, i) => (
              <div key={v.id} className="flex items-center gap-3 px-4 py-3" style={{ borderTop: i > 0 ? '1px solid #E5EBE8' : 'none' }}>
                <span className="flex-1 text-sm font-semibold" style={{ color: '#18211D' }}>⭐ {v.name}</span>
                <span className="text-[11px]" style={{ color: '#5B6660' }}>{v.category_ids.length} cat.</span>
                <button onClick={() => onDelete(v.id)} className="text-xs font-bold px-2 py-1 rounded-lg" style={{ background: '#FFE5E0', color: '#E25749' }}>Borrar</button>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#5B6660' }}>Nueva vista</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej: Comida, Compartido con pareja…"
          className="w-full rounded-2xl px-4 py-3 text-base font-bold mb-4 outline-none border-2"
          style={{ background: '#F1F5F3', color: '#18211D', borderColor: name ? '#2FA37C' : '#E5EBE8' }}
        />
        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#5B6660' }}>Categorías ({picked.size})</p>
        <div className="flex flex-col gap-1 mb-5 max-h-64 overflow-y-auto">
          {categories.map((c) => (
            <button key={c.id} onClick={() => toggle(c.id)} className="flex items-center gap-3 px-3 py-2 rounded-xl" style={{ background: picked.has(c.id) ? '#DDF0E8' : '#F1F5F3' }}>
              <span className="w-4 h-4 rounded-full shrink-0 flex items-center justify-center text-[10px] text-white" style={{ background: picked.has(c.id) ? '#1F8A68' : '#B0BAB4' }}>{picked.has(c.id) ? '✓' : ''}</span>
              <span className="text-lg">{c.icon}</span>
              <span className="text-sm font-semibold truncate" style={{ color: '#18211D' }}>{c.name}</span>
            </button>
          ))}
        </div>
        <button
          onClick={() => { if (name.trim() && picked.size) { onCreate(name.trim(), [...picked]); onClose(); } }}
          disabled={!name.trim() || picked.size === 0}
          className="w-full py-4 rounded-2xl font-bold text-white"
          style={{ background: name.trim() && picked.size ? '#2FA37C' : '#B0BAB4' }}
        >
          Crear vista
        </button>
      </div>
    </div>
  );
}

function PrioritiesSheet({
  categories, selected, onClose, onSave,
}: {
  categories: EnvelopeCategory[];
  selected: string[];
  onClose: () => void;
  onSave: (ids: string[]) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set(selected));
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center" style={{ background: 'rgba(20,28,24,0.45)' }} onClick={onClose}>
      <div className="w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl p-6 max-h-[88vh] overflow-y-auto" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)', paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }} onClick={(e) => e.stopPropagation()}>
        <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: '#E5EBE8' }} />
        <h2 className="text-lg font-black mb-1" style={{ color: '#18211D' }}>Prioridades del mes</h2>
        <p className="text-sm mb-4" style={{ color: '#5B6660' }}>¿Qué es lo importante este mes? Fijalo arriba para tenerlo a mano.</p>
        <div className="flex flex-col gap-1 mb-5">
          {categories.map((c) => (
            <button key={c.id} onClick={() => toggle(c.id)} className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ background: picked.has(c.id) ? '#DDF0E8' : '#F1F5F3' }}>
              <span className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[11px] text-white" style={{ background: picked.has(c.id) ? '#1F8A68' : '#B0BAB4' }}>{picked.has(c.id) ? '✓' : ''}</span>
              <span className="text-lg">{c.icon}</span>
              <span className="text-sm font-semibold truncate" style={{ color: '#18211D' }}>{c.name}</span>
            </button>
          ))}
        </div>
        <button onClick={() => { onSave([...picked]); onClose(); }} className="w-full py-4 rounded-2xl font-bold text-white" style={{ background: '#2FA37C' }}>Listo</button>
      </div>
    </div>
  );
}

function SpotlightView({
  env, priorityIds, expectedIncome, format, editable,
  onAdjustPriorities, onSetExpectedIncome, onGotoMonth,
}: {
  env: UseEnvelopeResult;
  priorityIds: string[];
  expectedIncome: number;
  format: (ars: number) => string;
  editable: boolean;
  onAdjustPriorities: () => void;
  onSetExpectedIncome: (n: number) => void;
  onGotoMonth: (month: string) => void;
}) {
  const catById = new Map(env.categories.map((c) => [c.id, c]));
  const priorities = priorityIds.map((id) => catById.get(id)).filter((c): c is EnvelopeCategory => !!c);

  // Savings-goal categories (is_goal) with a target, for the progress rings.
  const savingsGoals = env.categories
    .filter((c) => c.is_goal)
    .map((c) => ({ cat: c, info: env.targetInfoByCategory.get(c.id), available: env.rowByCategory.get(c.id)?.available ?? 0 }))
    .filter((g): g is { cat: EnvelopeCategory; info: TargetInfo; available: number } => !!g.info && g.info.totalArs > 0);

  const alerts: { cat: EnvelopeCategory; over: boolean; amount: number }[] = [];
  for (const r of env.rows) {
    const cat = catById.get(r.categoryId);
    if (!cat || cat.kind !== 'expense') continue;
    const needed = env.neededByCategory.get(r.categoryId) ?? 0;
    if (r.available < 0) alerts.push({ cat, over: true, amount: -r.available });
    else if (needed > 0) alerts.push({ cat, over: false, amount: needed });
  }
  alerts.sort((a, b) => (a.over ? 0 : 1) - (b.over ? 0 : 1) || b.amount - a.amount);

  const s = env.summary;
  const costToBeMe = s.totalTargets;
  const incomePct = expectedIncome > 0 ? Math.min(1, costToBeMe / expectedIncome) : 0;
  const nextMonth = monthKeyShift(1);
  const assignedNext = env.assignedFutureByMonth.find((m) => m.month === nextMonth)?.assigned ?? 0;
  const nextFundedPct = costToBeMe > 0 ? Math.min(1, assignedNext / costToBeMe) : 0;

  const PriorityRow = ({ cat }: { cat: EnvelopeCategory }) => {
    const r = env.rowByCategory.get(cat.id);
    const available = r?.available ?? 0;
    const needed = env.neededByCategory.get(cat.id) ?? 0;
    const pill = availPill(available, needed);
    return (
      <div className="flex items-center gap-3 rounded-2xl px-4 py-3" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
        <span className="text-lg">{cat.icon}</span>
        <span className="flex-1 min-w-0 text-sm font-semibold truncate" style={{ color: '#18211D' }}>{cat.name}</span>
        <span className="text-xs font-black px-2.5 py-1 rounded-full tabular-nums" style={{ background: pill.bg, color: pill.fg }}>{format(available)}</span>
      </div>
    );
  };

  return (
    <div className="px-4 flex flex-col gap-5">
      {/* Top Priorities */}
      <section>
        <div className="flex items-center justify-between mb-2 px-1">
          <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#5B6660' }}>Prioridades</p>
          {editable && <button onClick={onAdjustPriorities} className="text-xs font-bold" style={{ color: '#4E84E0' }}>Ajustar</button>}
        </div>
        {priorities.length > 0 ? (
          <div className="flex flex-col gap-2">{priorities.map((c) => <PriorityRow key={c.id} cat={c} />)}</div>
        ) : (
          <button onClick={editable ? onAdjustPriorities : undefined} className="w-full rounded-2xl p-4 text-center text-sm" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)', color: '#5B6660' }}>
            Fijá tus categorías importantes para tenerlas a mano.
          </button>
        )}
      </section>

      {/* Cost to Be Me */}
      <section className="rounded-3xl p-5" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
        <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#5B6660' }}>Lo que cuesta un mes de vos</p>
        <p className="text-3xl font-black mt-0.5" style={{ color: '#18211D', fontVariantNumeric: 'tabular-nums' }}>{format(costToBeMe)}</p>
        <p className="text-[11px] mb-3" style={{ color: '#5B6660' }}>Suma de todas tus metas del mes.</p>
        <div className="h-2.5 rounded-full overflow-hidden mb-1" style={{ background: '#E5EBE8' }}>
          <div className="h-full rounded-full" style={{ width: `${incomePct * 100}%`, background: incomePct >= 1 ? '#E25749' : '#2FA37C' }} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px]" style={{ color: '#5B6660' }}>Ingreso esperado</span>
          {editable ? (
            <MoneyField
              key={`inc-${expectedIncome}`}
              value={expectedIncome}
              onCommit={onSetExpectedIncome}
              placeholder="0"
              className="w-28 bg-transparent text-right text-sm font-bold tabular-nums outline-none rounded px-1 border-b border-dashed border-[#CFD8D3] focus:border-[#2FA37C]"
              style={{ color: '#18211D' }}
            />
          ) : (
            <span className="text-sm font-bold tabular-nums" style={{ color: '#18211D' }}>{format(expectedIncome)}</span>
          )}
        </div>
      </section>

      {/* Age of Money */}
      {env.ageOfMoney != null && (
        <section className="rounded-3xl p-5 flex items-center gap-4" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
          <span className="text-3xl shrink-0">🕰️</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#5B6660' }}>Antigüedad del dinero</p>
            <p className="text-2xl font-black leading-tight" style={{ color: '#18211D' }}>{env.ageOfMoney} días</p>
            <p className="text-[11px]" style={{ color: '#5B6660' }}>
              {env.ageOfMoney < 30
                ? 'Vivís bastante al día — apuntá a 30+ días de colchón.'
                : env.ageOfMoney < 60
                  ? 'Buen colchón: gastás plata que entró hace semanas.'
                  : 'Gran colchón: gastás plata de hace más de un mes. 🎉'}
            </p>
          </div>
        </section>
      )}

      {/* Savings goals (is_goal categories) with progress rings */}
      {savingsGoals.length > 0 && (
        <section>
          <p className="text-xs font-bold uppercase tracking-wide mb-2 px-1" style={{ color: '#5B6660' }}>Metas de ahorro</p>
          <div className="flex flex-col gap-2">
            {savingsGoals.map((g) => {
              const pct = g.info.pctComplete;
              return (
                <div key={g.cat.id} className="rounded-3xl p-4 flex items-center gap-4" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
                  <div className="relative w-14 h-14 shrink-0">
                    <svg viewBox="0 0 36 36" className="w-14 h-14 -rotate-90">
                      <circle cx="18" cy="18" r="15.9" fill="none" stroke="#E5EBE8" strokeWidth="4" />
                      <circle cx="18" cy="18" r="15.9" fill="none" stroke="#2FA37C" strokeWidth="4" strokeDasharray={`${pct * 100} 100`} strokeLinecap="round" />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-[11px] font-black" style={{ color: '#18211D' }}>{Math.round(pct * 100)}%</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black truncate" style={{ color: '#18211D' }}>{g.cat.icon} {g.cat.name}</p>
                    <p className="text-xs tabular-nums" style={{ color: '#5B6660' }}>{format(g.available)} de {format(g.info.totalArs)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Monthly Summary */}
      <section>
        <p className="text-xs font-bold uppercase tracking-wide mb-2 px-1" style={{ color: '#5B6660' }}>Resumen del mes</p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Metas totales', value: s.totalTargets, color: '#18211D' },
            { label: 'Sin financiar', value: s.underfunded, color: s.underfunded > 0 ? '#C79A2B' : '#1F8A68' },
            { label: 'Asignado', value: s.assigned, color: '#18211D' },
            { label: 'Gastado', value: s.spent, color: '#FF6F61' },
          ].map((c) => (
            <div key={c.label} className="rounded-2xl p-4" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
              <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: '#5B6660' }}>{c.label}</p>
              <p className="text-lg font-black tabular-nums" style={{ color: c.color }}>{format(c.value)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Assigned in Future Months */}
      <section>
        <p className="text-xs font-bold uppercase tracking-wide mb-2 px-1" style={{ color: '#5B6660' }}>Asignado en meses futuros</p>
        <div className="rounded-3xl p-5" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
          <div className="flex items-center gap-3 mb-3">
            <div className="relative w-14 h-14 shrink-0">
              <svg viewBox="0 0 36 36" className="w-14 h-14 -rotate-90">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#E5EBE8" strokeWidth="4" />
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#2FA37C" strokeWidth="4" strokeDasharray={`${nextFundedPct * 100} 100`} strokeLinecap="round" />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-[11px] font-black" style={{ color: '#18211D' }}>{Math.round(nextFundedPct * 100)}%</span>
            </div>
            <p className="text-xs" style={{ color: '#5B6660' }}>El mes que viene está financiado al <b>{Math.round(nextFundedPct * 100)}%</b> de tus metas. Asigná hacia adelante para adelantarte un mes.</p>
          </div>
          {env.assignedFutureByMonth.length === 0 ? (
            <p className="text-sm text-center py-2" style={{ color: '#5B6660' }}>Todavía no asignaste a meses futuros.</p>
          ) : (
            <div className="flex flex-col">
              {env.assignedFutureByMonth.map((m, i) => (
                <button key={m.month} onClick={() => onGotoMonth(m.month)} className="flex items-center justify-between py-2.5" style={{ borderTop: i > 0 ? '1px solid #EAF0ED' : 'none' }}>
                  <span className="text-sm font-semibold" style={{ color: '#18211D' }}>{monthLabel(m.month)}</span>
                  <span className="text-sm font-black tabular-nums" style={{ color: '#1F8A68' }}>{format(m.assigned)} ›</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Compromisos futuros — cuotas y cargos ya agendados para meses próximos */}
      {env.futureCommitmentsByMonth.length > 0 && (
        <section>
          <p className="text-xs font-bold uppercase tracking-wide mb-2 px-1" style={{ color: '#5B6660' }}>Compromisos futuros</p>
          <div className="rounded-3xl p-5" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
            <p className="text-3xl font-black" style={{ color: '#18211D', fontVariantNumeric: 'tabular-nums' }}>{format(env.futureCommitmentsTotal)}</p>
            <p className="text-[11px] mb-3" style={{ color: '#5B6660' }}>
              Tu parte de cuotas y gastos fijos ya agendados para meses que vienen. No te bajan este mes, pero ya están prometidos.
            </p>
            <div className="flex flex-col">
              {env.futureCommitmentsByMonth.map((m, i) => {
                const covered = m.assigned >= m.amountArs;
                return (
                  <button key={m.month} onClick={() => onGotoMonth(m.month)} className="flex items-center justify-between gap-3 py-2.5 text-left" style={{ borderTop: i > 0 ? '1px solid #EAF0ED' : 'none' }}>
                    <div className="min-w-0">
                      <span className="text-sm font-semibold" style={{ color: '#18211D' }}>{monthLabel(m.month)}</span>
                      <span className="text-[11px] ml-2" style={{ color: '#8C968F' }}>{m.count} {m.count === 1 ? 'movimiento' : 'movimientos'}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={covered ? { background: '#DDF0E8', color: '#1F8A68' } : { background: '#FBF0D6', color: '#C79A2B' }}>
                        {covered ? 'Cubierto' : 'A financiar'}
                      </span>
                      <span className="text-sm font-black tabular-nums" style={{ color: '#18211D' }}>{format(m.amountArs)} ›</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Prioritized alerts */}
      {alerts.length > 0 && (
        <section>
          <p className="text-xs font-bold uppercase tracking-wide mb-2 px-1" style={{ color: '#5B6660' }}>Qué atacar primero</p>
          <div className="rounded-3xl overflow-hidden" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
            {alerts.map((a, i) => (
              <div key={a.cat.id} className="flex items-center gap-3 px-4 py-3" style={{ borderTop: i > 0 ? '1px solid #EAF0ED' : 'none' }}>
                <span className="text-lg">{a.cat.icon}</span>
                <span className="flex-1 min-w-0 text-sm font-semibold truncate" style={{ color: '#18211D' }}>{a.cat.name}</span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={a.over ? { background: '#FFE5E0', color: '#E25749' } : { background: '#FBF0D6', color: '#C79A2B' }}>
                  {a.over ? `Sobregiraste ${format(a.amount)}` : `Faltan ${format(a.amount)}`}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// monthKey() shifted by delta months — small local helper for Spotlight.
function monthKeyShift(delta: number): string {
  const d = new Date();
  const shifted = new Date(d.getFullYear(), d.getMonth() + delta, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}`;
}

export default function PresupuestosClient({ profile }: { profile: Profile }) {
  const supabase = createClient();
  const qc = useQueryClient();
  const { format } = useFx();

  const [month, setMonth] = useState<string>(monthKey());
  const [tab, setTab] = useState<'categories' | 'spotlight'>('categories');
  const [view, setView] = useState<'mine' | 'partner'>('mine');
  const [filter, setFilter] = useState<string>('all'); // 'all'|'overspent'|'underfunded'|'overfunded'|'available'|`view:<id>`
  const [autoMenuOpen, setAutoMenuOpen] = useState(false);
  const [newViewOpen, setNewViewOpen] = useState(false);
  const [prioritiesOpen, setPrioritiesOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [detailCat, setDetailCat] = useState<EnvelopeCategory | null>(null);
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fabType, setFabType] = useState<'expense' | 'income' | 'transfer'>('expense');

  const partnerQ = useQuery({
    queryKey: ['partner', profile.household_id, profile.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, nickname, display_name')
        .eq('household_id', profile.household_id)
        .neq('id', profile.id)
        .maybeSingle();
      return data ?? null;
    },
  });
  const partner = partnerQ.data;

  const accountsQ = useQuery({
    queryKey: ['accounts', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('accounts')
        .select('id, name, type, owner_profile_id, payment_category_id, archived')
        .eq('household_id', profile.household_id)
        .order('name');
      return data ?? [];
    },
  });
  const accounts = useMemo(() => accountsQ.data ?? [], [accountsQ.data]);
  const activeAccounts = accounts.filter((a) => !a.archived);

  const targetProfileId = view === 'partner' && partner ? partner.id : profile.id;
  const editable = view === 'mine';

  const env = useEnvelope(profile.household_id, targetProfileId, month);

  // What the partner owes me (net > 0). When I front a shared expense my cash
  // drops by the whole bill but my envelope only by my share, so this receivable
  // sits invisibly inside "Para asignar" until I'm paid back — surfacing it here
  // explains why the number looks lower than my cash suggests. From my own
  // perspective only (the couple balance is computed as mine), so the partner-view.
  const { net: coupleNet } = useCoupleBalance(profile.household_id, profile.id, partner?.id);
  const receivable = editable && coupleNet > 0 ? Math.round(coupleNet) : 0;

  const paymentCatOwner = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const a of accounts) {
      if (a.type === 'credit' && a.payment_category_id) m.set(a.payment_category_id, a.owner_profile_id);
    }
    return m;
  }, [accounts]);

  const groups = useMemo(() => {
    // Group headers (is_group) are the YNAB-style master categories; leaf
    // categories nest under them via parent_id. Card-payment envelopes get their
    // own "Tarjetas" group; leaves with no group fall under "Sin grupo".
    const headerById = new Map<string, EnvelopeCategory>();
    for (const c of env.categories) if (c.is_group) headerById.set(c.id, c);
    const byGroup = new Map<string, EnvelopeCategory[]>();
    const cards: EnvelopeCategory[] = [];
    const ungrouped: EnvelopeCategory[] = [];
    for (const c of env.categories) {
      if (c.kind !== 'expense' || c.is_group) continue;
      if (paymentCatOwner.has(c.id)) {
        if (paymentCatOwner.get(c.id) === targetProfileId) cards.push(c);
        continue;
      }
      if (c.parent_id && headerById.has(c.parent_id)) {
        let arr = byGroup.get(c.parent_id);
        if (!arr) { arr = []; byGroup.set(c.parent_id, arr); }
        arr.push(c);
      } else {
        ungrouped.push(c);
      }
    }
    const byName = (a: EnvelopeCategory, b: EnvelopeCategory) => a.name.localeCompare(b.name);
    const ORDER = ['Variables', 'Ocio', 'Fijos', 'Ahorro y metas'];
    const headers = [...headerById.values()].sort((a, b) => {
      const ia = ORDER.indexOf(a.name), ib = ORDER.indexOf(b.name);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.name.localeCompare(b.name);
    });
    const result: { key: string; title: string; cats: EnvelopeCategory[] }[] = [];
    for (const h of headers) {
      const cats = (byGroup.get(h.id) ?? []).sort(byName);
      if (cats.length) result.push({ key: h.id, title: `${h.icon} ${h.name}`, cats });
    }
    if (cards.length) result.push({ key: 'cards', title: '💳 Tarjetas', cats: cards.sort(byName) });
    if (ungrouped.length) result.push({ key: 'ungrouped', title: 'Sin grupo', cats: ungrouped.sort(byName) });
    return result;
  }, [env.categories, paymentCatOwner, targetProfileId]);

  // All expense categories (for the "move to another envelope" picker).
  const expenseCats = useMemo(() => env.categories.filter((c) => c.kind === 'expense' && !c.is_group), [env.categories]);
  // Group headers (is_group) for the "move to group" picker in the detail sheet.
  const groupCats = useMemo(() => env.categories.filter((c) => c.is_group).sort((a, b) => a.name.localeCompare(b.name)), [env.categories]);
  // Categories pickable for a transaction (exclude group headers).
  const pickerCats = useMemo(() => env.categories.filter((c) => !c.is_group), [env.categories]);

  // Spotlight prefs (Top Priorities + expected income) live in notification_prefs.
  type Prefs = { priority_category_ids?: string[]; expected_income?: number; featured_category_id?: string; hidden_category_ids?: string[] };
  const prefsQ = useQuery({
    queryKey: ['profile-prefs', profile.id],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('notification_prefs').eq('id', profile.id).maybeSingle();
      return (data?.notification_prefs ?? {}) as Prefs;
    },
  });
  const prefs = prefsQ.data ?? {};
  const priorityIds = useMemo(() => prefs.priority_category_ids ?? [], [prefs.priority_category_ids]);
  const expectedIncome = prefs.expected_income ?? 0;
  // Categories the user chose to hide (won't assign anything to). Hidden purely
  // visually — their money still counts toward subtotals and "Para asignar".
  const hiddenIds = useMemo(() => new Set(prefs.hidden_category_ids ?? []), [prefs.hidden_category_ids]);
  const toggleHidden = (categoryId: string) => {
    const next = new Set(hiddenIds);
    if (next.has(categoryId)) next.delete(categoryId); else next.add(categoryId);
    updatePrefs.mutate({ hidden_category_ids: [...next] });
  };
  const updatePrefs = useMutation({
    mutationFn: async (patch: Partial<Prefs>) => {
      const next = { ...prefs, ...patch };
      const { error } = await supabase.from('profiles').update({ notification_prefs: next }).eq('id', profile.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profile-prefs', profile.id] }),
  });

  // Saved "focused views" (named subsets of categories).
  const viewsQ = useQuery({
    queryKey: ['budget-views', profile.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('budget_views')
        .select('id, name, category_ids')
        .eq('profile_id', profile.id)
        .order('created_at');
      return data ?? [];
    },
  });
  const savedViews = viewsQ.data ?? [];
  const createView = useMutation({
    mutationFn: async ({ name, categoryIds }: { name: string; categoryIds: string[] }) => {
      const { error } = await supabase.from('budget_views').insert({
        household_id: profile.household_id, profile_id: profile.id, name, category_ids: categoryIds,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budget-views', profile.id] }),
  });
  const deleteView = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('budget_views').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['budget-views', profile.id] }); setFilter('all'); },
  });

  // Suggested target amounts from spending history (only fetched when a detail
  // is open). The edge function returns suggestions per category.
  const suggestionsQ = useQuery({
    queryKey: ['suggest-targets', profile.id],
    enabled: !!detailCat,
    staleTime: 1000 * 60 * 30,
    queryFn: async () => {
      const { data } = await supabase.functions.invoke('suggest-budgets', { body: { scope: 'personal' } });
      return ((data as { suggestions?: { category_id: string; suggested: number }[] } | null)?.suggestions ?? []);
    },
  });
  const suggestedByCategory = new Map((suggestionsQ.data ?? []).map((s) => [s.category_id, s.suggested]));

  // Focused-view predicate: does a category pass the active filter/chip?
  const activeViewIds = filter.startsWith('view:')
    ? new Set(savedViews.find((v) => `view:${v.id}` === filter)?.category_ids ?? [])
    : null;
  function matchesFilter(catId: string): boolean {
    if (filter === 'all') return true;
    if (activeViewIds) return activeViewIds.has(catId);
    const r = env.rowByCategory.get(catId);
    const available = r?.available ?? 0;
    const target = env.targetByCategory.get(catId) ?? 0;
    const needed = env.neededByCategory.get(catId) ?? 0;
    if (filter === 'overspent') return available < 0;
    if (filter === 'underfunded') return available >= 0 && needed > 0;
    if (filter === 'overfunded') return target > 0 && needed <= 0 && available > target;
    if (filter === 'available') return available > 0;
    return true;
  }

  const bulkAssign = useMutation({
    mutationFn: async (updates: { categoryId: string; assigned: number }[]) => {
      if (!updates.length) return;
      const rows = updates.map((u) => ({
        household_id: profile.household_id,
        profile_id: profile.id,
        category_id: u.categoryId,
        month,
        assigned: u.assigned,
        currency: 'ARS',
      }));
      const { error } = await supabase.from('budget_months').upsert(rows, { onConflict: 'profile_id,category_id,month' });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['envelope', profile.id] }),
  });

  const createCategory = useMutation({
    mutationFn: async ({ name, icon, isGroup, parentId }: { name: string; icon: string; isGroup?: boolean; parentId?: string | null }) => {
      const { error } = await supabase
        .from('categories')
        .insert({ household_id: profile.household_id, name, icon, kind: 'expense', is_default: false, is_group: !!isGroup, parent_id: isGroup ? null : (parentId ?? null) });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['categories', profile.household_id] }); qc.invalidateQueries({ queryKey: ['envelope-categories', profile.household_id] }); },
  });

  const renameCategory = useMutation({
    mutationFn: async ({ categoryId, name, icon }: { categoryId: string; name: string; icon: string }) => {
      const { error } = await supabase.from('categories').update({ name, icon }).eq('id', categoryId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['categories', profile.household_id] }); qc.invalidateQueries({ queryKey: ['envelope-categories', profile.household_id] }); },
  });

  const moveToGroup = useMutation({
    mutationFn: async ({ categoryId, groupId }: { categoryId: string; groupId: string | null }) => {
      const { error } = await supabase.from('categories').update({ parent_id: groupId }).eq('id', categoryId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['categories', profile.household_id] }); qc.invalidateQueries({ queryKey: ['envelope-categories', profile.household_id] }); },
  });

  const saveTarget = useMutation({
    mutationFn: async ({ categoryId, amount, cadence, date, targetType }: { categoryId: string; amount: number; cadence: 'monthly' | 'by_date' | 'weekly'; date: string | null; targetType: 'refill' | 'set_aside' }) => {
      const { error } = await supabase.from('category_targets').upsert(
        { household_id: profile.household_id, profile_id: profile.id, category_id: categoryId, target_amount: amount, cadence, target_date: cadence === 'by_date' ? date : null, target_type: cadence === 'by_date' ? 'refill' : targetType, currency: 'ARS' },
        { onConflict: 'profile_id,category_id' },
      );
      if (error) throw error;
      // A by-date target makes the category a savings goal.
      if (cadence === 'by_date') await supabase.from('categories').update({ is_goal: true }).eq('id', categoryId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['envelope-targets', profile.id] });
      qc.invalidateQueries({ queryKey: ['categories', profile.household_id] });
      qc.invalidateQueries({ queryKey: ['envelope-categories', profile.household_id] });
    },
  });

  function assignOne(categoryId: string, assigned: number) {
    bulkAssign.mutate([{ categoryId, assigned }]);
  }
  function moveMoney(fromCat: string, toCat: string, amount: number) {
    const fromR = env.rowByCategory.get(fromCat);
    const toR = env.rowByCategory.get(toCat);
    bulkAssign.mutate([
      { categoryId: fromCat, assigned: (fromR?.assigned ?? 0) - amount },
      { categoryId: toCat, assigned: (toR?.assigned ?? 0) + amount },
    ]);
  }
  function coverOverspent() {
    const updates = env.rows.filter((r) => r.available < 0).map((r) => ({ categoryId: r.categoryId, assigned: r.assigned - r.available }));
    if (updates.length) bulkAssign.mutate(updates);
  }
  function autoAssignTargets() {
    const updates: { categoryId: string; assigned: number }[] = [];
    for (const [catId, needed] of env.neededByCategory) {
      if (needed <= 0) continue;
      const r = env.rowByCategory.get(catId);
      updates.push({ categoryId: catId, assigned: (r?.assigned ?? 0) + needed });
    }
    if (updates.length) bulkAssign.mutate(updates);
  }
  function applyAutoAssign(strategy: AutoAssignStrategy) {
    const updates = [...env.autoAssignAmounts(strategy).entries()].map(([categoryId, assigned]) => ({ categoryId, assigned }));
    if (updates.length) bulkAssign.mutate(updates);
    setAutoMenuOpen(false);
  }

  const overspentCount = env.rows.filter((r) => r.available < 0).length;
  const underfundedCount = useMemo(() => {
    let n = 0;
    for (const [, needed] of env.neededByCategory) if (needed > 0) n++;
    return n;
  }, [env.neededByCategory]);

  // Counts for the focused-view chips.
  const chipCounts = useMemo(() => {
    let overspent = 0, underfunded = 0, overfunded = 0, available = 0;
    for (const c of expenseCats) {
      const a = env.rowByCategory.get(c.id)?.available ?? 0;
      const t = env.targetByCategory.get(c.id) ?? 0;
      const needed = env.neededByCategory.get(c.id) ?? 0;
      if (a < 0) overspent++;
      else if (needed > 0) underfunded++;
      if (t > 0 && needed <= 0 && a > t) overfunded++;
      if (a > 0) available++;
    }
    return { overspent, underfunded, overfunded, available };
  }, [expenseCats, env.rowByCategory, env.targetByCategory, env.neededByCategory]);

  const rta = env.readyToAssign;
  // "Para asignar" = tu efectivo on-budget − lo ya guardado en categorías (el
  // disponible positivo de tus sobres). Lo derivamos al revés para el desglose.
  const funded = env.cash - rta;

  function toggleGroup(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function closeSheet() {
    setSheetOpen(false);
    qc.invalidateQueries({ queryKey: ['envelope-tx'] });
    qc.invalidateQueries({ queryKey: ['envelope', profile.id] });
  }

  const detailRow = detailCat ? env.rowByCategory.get(detailCat.id) : undefined;

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F1F5F3' }}>
      <header className="px-5 pt-14 pb-3">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-black" style={{ color: '#18211D' }}>Presupuesto</h1>
          <div className="flex items-center gap-1">
            <button onClick={() => setMonth((m) => shiftMonth(m, -1))} className="w-8 h-8 rounded-full text-lg flex items-center justify-center" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)', color: '#5B6660' }} aria-label="Mes anterior">‹</button>
            <span className="text-sm font-bold min-w-[7.5rem] text-center" style={{ color: '#18211D' }}>{monthLabel(month)}</span>
            <button onClick={() => setMonth((m) => shiftMonth(m, 1))} className="w-8 h-8 rounded-full text-lg flex items-center justify-center" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)', color: '#5B6660' }} aria-label="Mes siguiente">›</button>
          </div>
        </div>
      </header>

      {partner && (
        <div className="mx-4 mb-3 flex rounded-2xl overflow-hidden p-1 gap-1" style={{ background: '#E5EBE8' }}>
          {([{ k: 'mine', label: 'Mío' }, { k: 'partner', label: partner.nickname || 'Pareja' }] as const).map((t) => (
            <button key={t.k} onClick={() => setView(t.k)} className="flex-1 py-2 text-xs font-black rounded-xl transition-all" style={{ background: view === t.k ? '#FFFFFF' : 'transparent', color: view === t.k ? '#18211D' : '#5B6660', boxShadow: view === t.k ? 'var(--shadow-soft)' : 'none' }}>{t.label}</button>
          ))}
        </div>
      )}

      {/* "Para asignar" — premium two-zone hero: gradient headline + white details */}
      <div className="mx-4 mb-4 rounded-3xl overflow-hidden" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-pop)' }}>
        <div
          className="relative px-5 pt-5 pb-5 overflow-hidden"
          style={{
            background: rta < 0
              ? 'linear-gradient(135deg, #FF8173 0%, #E25749 100%)'
              : 'linear-gradient(135deg, #34AD84 0%, #1F8A68 100%)',
          }}
        >
          {/* soft light flare for depth */}
          <div className="absolute -top-10 -right-8 w-40 h-40 rounded-full pointer-events-none" style={{ background: 'rgba(255,255,255,0.14)' }} />
          <div className="relative flex items-center justify-between">
            <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.82)' }}>
              {editable ? 'Para asignar' : `Para asignar · ${partner?.nickname || 'Pareja'}`}
            </p>
            <span className="text-base leading-none">{rta < 0 ? '⚠️' : rta > 0 ? '💸' : '🎉'}</span>
          </div>
          <p className="relative text-[2.6rem] leading-none font-black mt-2 tracking-tight" style={{ color: '#FFFFFF', fontVariantNumeric: 'tabular-nums' }}>{format(rta)}</p>
          <p className="relative text-[11px] mt-2.5 leading-snug" style={{ color: 'rgba(255,255,255,0.9)' }}>
            {rta > 0 ? 'Plata en cuentas todavía sin un trabajo. Asignala a una categoría.' : rta < 0 ? 'Asignaste (o fronteaste) más de lo que tenés. Sacá de alguna categoría.' : 'Cada peso tiene un trabajo. 🎉'}
          </p>
        </div>

        <div className="px-4 py-4">
          {/* breakdown: cash − funded = rta */}
          <div className="flex items-stretch rounded-2xl overflow-hidden" style={{ background: '#F1F5F3' }}>
            <div className="flex-1 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: '#8C968F' }}>{editable ? 'Tus cuentas' : 'Sus cuentas'}</p>
              <p className="text-sm font-black tabular-nums" style={{ color: '#18211D' }}>{format(env.cash)}</p>
            </div>
            <div className="w-px my-2" style={{ background: '#E5EBE8' }} />
            <div className="flex-1 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: '#8C968F' }}>En categorías</p>
              <p className="text-sm font-black tabular-nums" style={{ color: '#18211D' }}>{format(funded)}</p>
            </div>
          </div>
          <p className="text-[10px] mt-1.5 px-1" style={{ color: '#8C968F' }}>
            Solo {editable ? 'tus' : 'sus'} cuentas on-budget · asignado este mes {format(env.assignedTotal)}
          </p>
        {receivable > 0 && (
          <div className="mt-3 flex items-center gap-2 rounded-2xl px-3 py-2" style={{ background: '#DDF0E8' }}>
            <span className="text-base">💸</span>
            <p className="text-[11px] leading-snug flex-1" style={{ color: '#5B6660' }}>
              <b style={{ color: '#1F8A68' }}>{partner?.nickname || 'Tu pareja'} te debe {format(receivable)}</b> — plata que fronteaste. Te baja “Para asignar” hasta que te la devuelva.
            </p>
          </div>
        )}
        {editable && overspentCount >= 4 && (
          <p className="text-[11px] mt-3 leading-snug" style={{ color: '#5B6660' }}>
            Empezaste a presupuestar a mitad de mes. Tocá <b>Cubrir lo ya gastado</b> para asignar
            retroactivamente lo que ya saliste gastando y partir en cero (no te baja “Para asignar”).
          </p>
        )}
        {editable && (
          <div className="mt-3">
            <div className="flex flex-wrap gap-2">
              {overspentCount > 0 && (
                <button onClick={coverOverspent} className="text-xs font-bold px-3 py-2 rounded-xl" style={{ background: '#FFE5E0', color: '#E25749' }}>
                  Cubrir lo ya gastado ({overspentCount})
                </button>
              )}
              {underfundedCount > 0 && (
                <button onClick={autoAssignTargets} className="text-xs font-bold px-3 py-2 rounded-xl" style={{ background: '#FDF1D8', color: '#B8860B' }}>
                  Asignar a metas ({underfundedCount})
                </button>
              )}
              <button onClick={() => setAutoMenuOpen((v) => !v)} className="text-xs font-bold px-3 py-2 rounded-xl" style={{ background: '#DDF0E8', color: '#1F8A68' }}>
                ⚡ Auto-asignar {autoMenuOpen ? '▴' : '▾'}
              </button>
            </div>
            {autoMenuOpen && (
              <div className="mt-2 flex flex-col gap-1 rounded-2xl p-2" style={{ background: '#F1F5F3' }}>
                {([
                  { k: 'last_assigned', label: 'Igual que el mes pasado (asignado)' },
                  { k: 'last_spent', label: 'Gastado el mes pasado' },
                  { k: 'avg3_spent', label: 'Promedio de gasto (3 meses)' },
                  { k: 'reset_available', label: 'Resetear disponible a 0' },
                ] as const).map((o) => (
                  <button key={o.k} onClick={() => applyAutoAssign(o.k)} className="text-left text-xs font-semibold px-3 py-2 rounded-xl" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)', color: '#18211D' }}>
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        </div>
      </div>

      {/* Categorías | Spotlight toggle */}
      <div className="mx-4 mb-3 flex rounded-2xl overflow-hidden p-1 gap-1" style={{ background: '#E5EBE8' }}>
        {([{ k: 'categories', label: 'Categorías' }, { k: 'spotlight', label: '✨ Spotlight' }] as const).map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)} className="flex-1 py-2 text-xs font-black rounded-xl transition-all" style={{ background: tab === t.k ? '#FFFFFF' : 'transparent', color: tab === t.k ? '#18211D' : '#5B6660', boxShadow: tab === t.k ? 'var(--shadow-soft)' : 'none' }}>{t.label}</button>
        ))}
      </div>

      {tab === 'spotlight' ? (
        <SpotlightView
          env={env}
          priorityIds={priorityIds}
          expectedIncome={expectedIncome}
          format={format}
          editable={editable}
          onAdjustPriorities={() => setPrioritiesOpen(true)}
          onSetExpectedIncome={(n) => updatePrefs.mutate({ expected_income: n })}
          onGotoMonth={(m) => { setMonth(m); setTab('categories'); }}
        />
      ) : (
        <>
      {/* Focused views — filter chips */}
      <div className="flex gap-2 overflow-x-auto px-4 mb-3 pb-1" style={{ scrollbarWidth: 'none' }}>
        {([
          { k: 'all', label: 'Todos', n: null as number | null },
          { k: 'overspent', label: 'Sobregirados', n: chipCounts.overspent },
          { k: 'underfunded', label: 'Bajo la meta', n: chipCounts.underfunded },
          { k: 'overfunded', label: 'Sobre-financiados', n: chipCounts.overfunded },
          { k: 'available', label: 'Con disponible', n: chipCounts.available },
        ] as const).map((chip) => (
          <button
            key={chip.k}
            onClick={() => setFilter(chip.k)}
            className="shrink-0 text-xs font-bold px-3.5 py-2 rounded-full whitespace-nowrap transition-all"
            style={{ background: filter === chip.k ? '#2FA37C' : '#FFFFFF', color: filter === chip.k ? '#FFFFFF' : '#5B6660', boxShadow: filter === chip.k ? '0 4px 12px -4px rgba(47,163,124,0.55)' : 'var(--shadow-soft)' }}
          >
            {chip.label}{chip.n != null && chip.n > 0 ? ` ${chip.n}` : ''}
          </button>
        ))}
        {savedViews.map((v) => (
          <button
            key={v.id}
            onClick={() => setFilter(`view:${v.id}`)}
            className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-full whitespace-nowrap"
            style={{ background: filter === `view:${v.id}` ? '#4E84E0' : '#FFFFFF', color: filter === `view:${v.id}` ? '#FFFFFF' : '#5B6660' }}
          >
            ⭐ {v.name}
          </button>
        ))}
        {hiddenIds.size > 0 && (
          <button
            onClick={() => setShowHidden((v) => !v)}
            className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-full whitespace-nowrap"
            style={{ background: showHidden ? '#5B6660' : '#FFFFFF', color: showHidden ? '#FFFFFF' : '#5B6660' }}
          >
            {showHidden ? '🙈 Ocultar ocultas' : `👁 Ocultas ${hiddenIds.size}`}
          </button>
        )}
        {editable && (
          <button
            onClick={() => setNewViewOpen(true)}
            className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-full whitespace-nowrap border-2 border-dashed"
            style={{ borderColor: '#CFD8D3', color: '#5B6660', background: 'transparent' }}
          >
            + Vista
          </button>
        )}
      </div>

      <div className="px-4 flex flex-col gap-4">
        {env.isLoading ? (
          <div className="rounded-3xl p-8 text-center text-sm" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)', color: '#5B6660' }}>Cargando…</div>
        ) : (
          groups.map((g) => {
            const cats = g.cats
              .filter((c) => matchesFilter(c.id))
              .filter((c) => showHidden || !hiddenIds.has(c.id))
              // Most-assigned first so the envelopes you still feed sit on top
              // and the ones you barely touch sink to the bottom.
              .sort((a, b) => (env.rowByCategory.get(b.id)?.assigned ?? 0) - (env.rowByCategory.get(a.id)?.assigned ?? 0));
            if (cats.length === 0) return null;
            const sub = cats.reduce(
              (acc, c) => {
                const r = env.rowByCategory.get(c.id);
                acc.assigned += r?.assigned ?? 0;
                acc.activity += r?.activity ?? 0;
                acc.available += r?.available ?? 0;
                return acc;
              },
              { assigned: 0, activity: 0, available: 0 },
            );
            const isCollapsed = collapsed.has(g.key);
            return (
              <div key={g.key}>
                {/* Group header = collapsible + subtotals */}
                <button onClick={() => toggleGroup(g.key)} className="w-full flex items-center gap-2 px-3 mb-1.5">
                  <span className="text-[10px]" style={{ color: '#5B6660' }}>{isCollapsed ? '▸' : '▾'}</span>
                  <p className="flex-1 text-left text-xs font-bold uppercase tracking-wide" style={{ color: '#5B6660' }}>{g.title}</p>
                  <span className="text-[12px] font-black tabular-nums" style={{ color: availColor(sub.available, 0) }}>{fmtCell(sub.available)}</span>
                </button>

                {!isCollapsed && (
                  <div className="rounded-3xl overflow-hidden" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
                    {cats.map((c, i) => {
                      const row = env.rowByCategory.get(c.id);
                      const assigned = row?.assigned ?? 0;
                      const activity = row?.activity ?? 0;
                      const available = row?.available ?? 0;
                      const target = env.targetByCategory.get(c.id) ?? 0;
                      const info = env.targetInfoByCategory.get(c.id);
                      // How much more to assign this month to be on track (per
                      // target type — refill vs set_aside). Drives the colour and
                      // the "falta" status so a fully-budgeted monthly budget
                      // doesn't nag you to re-fund what you already spent.
                      const needed = env.neededByCategory.get(c.id) ?? 0;
                      const fg = availColor(available, needed);
                      // A "Presupuesto del mes" (set_aside) is a spending budget:
                      // once funded, it should read "spent X of budget", not
                      // "Faltan" — that's the whole point of the type.
                      const isMonthlyBudget = info?.targetType === 'set_aside' && info.cadence !== 'by_date';
                      // What was in the envelope this month: assignment + carry-over.
                      const pool = activity + Math.max(0, available);
                      // Per-category bar fill:
                      //  - Savings goals fill as you FUND them (progress toward the goal).
                      //  - Regular envelopes fill as you SPEND them (gasto vs what's in
                      //    the envelope), so $180k de $200k se ve casi lleno, no casi
                      //    vacío. Overspent = barra llena.
                      const barPct = c.is_goal && target > 0
                        ? Math.max(0, Math.min(1, available / target)) * 100
                        : available < 0
                          ? 100
                          : pool > 0 ? Math.min(1, activity / pool) * 100 : 0;
                      // YNAB-style status text under the name.
                      let statusText = '';
                      let statusColor = '#5B6660';
                      if (available < 0) { statusText = `Sobregiraste ${fmtCell(-available)}`; statusColor = '#E25749'; }
                      else if (needed > 0) { statusText = `${isMonthlyBudget ? 'Falta asignar' : 'Faltan'} ${fmtCell(needed)}`; statusColor = '#C79A2B'; }
                      else if (isMonthlyBudget) {
                        // Funded monthly budget → spend against the budget amount.
                        statusText = activity > 0 ? `Gastaste ${fmtCell(activity)} de ${fmtCell(target)}${available <= 0 ? ' · todo' : ''}` : 'Financiado';
                        statusColor = activity > 0 ? '#5B6660' : '#1F8A68';
                      }
                      else if (target > 0) { statusText = '✓ Meta cumplida'; statusColor = '#1F8A68'; }
                      else if (assigned <= 0 && activity <= 0) { statusText = ''; }
                      else if (activity <= 0) { statusText = 'Financiado'; statusColor = '#1F8A68'; }
                      else {
                        // YNAB "spent X of Y": Y is what was in the envelope this
                        // month (assignment + carry-over = `pool`). A fully-drained
                        // envelope reads "· todo".
                        statusText = `Gastaste ${fmtCell(activity)} de ${fmtCell(pool)}${available <= 0 ? ' · todo' : ''}`;
                        statusColor = '#5B6660';
                      }
                      return (
                        <div
                          key={c.id}
                          onClick={() => setDetailCat(c)}
                          role="button"
                          tabIndex={0}
                          className="px-4 py-3 cursor-pointer transition-colors hover:bg-[#F4F8F6] active:bg-[#EEF3F1]"
                          style={{ borderTop: i > 0 ? '1px solid #EAF0ED' : 'none' }}
                        >
                          <div className="flex items-center gap-2">
                          <span className="relative shrink-0 text-lg">
                            {c.color && (
                              <span className="absolute -left-1 top-1 w-1.5 h-1.5 rounded-full" style={{ background: c.color }} />
                            )}
                            {c.icon}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate" style={{ color: '#18211D' }}>{c.name}</p>
                            {statusText && (
                              <p className="text-[10px] font-semibold" style={{ color: statusColor }}>{statusText}</p>
                            )}
                            {/* Per-category bar: how full the envelope is (toward its
                                target, or its assignment). Shown on every row for a
                                consistent look; empty track when nothing's in it. */}
                            <div className="mt-1.5 h-1.5 rounded-full overflow-hidden" style={{ background: '#EAF0ED' }}>
                              <div className="h-full rounded-full transition-all" style={{ width: `${barPct}%`, background: fg }} />
                            </div>
                          </div>
                          {/* YNAB mobile: only the Available pill; tap the row to assign. */}
                          <span className="shrink-0">
                            <span className="inline-block px-2.5 py-1 rounded-full text-sm font-black tabular-nums" style={{ background: availPill(available, needed).bg, color: availPill(available, needed).fg }}>
                              {fmtCell(available)}
                            </span>
                          </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
        {editable && !env.isLoading && (
          <button
            onClick={() => setNewCatOpen(true)}
            className="rounded-2xl py-3 text-sm font-bold border-2 border-dashed"
            style={{ borderColor: '#CFD8D3', color: '#5B6660', background: 'transparent' }}
          >
            ➕ Nueva categoría
          </button>
        )}
      </div>
        </>
      )}

      <BottomNav onFab={(type) => { setFabType(type); setSheetOpen(true); }} />

      <AddTransactionSheet
        open={sheetOpen}
        initialType={fabType}
        onClose={closeSheet}
        householdId={profile.household_id}
        profileId={profile.id}
        categories={pickerCats}
        accounts={activeAccounts}
      />

      {detailCat && (
        <CategoryDetailSheet
          key={detailCat.id}
          category={detailCat}
          row={detailRow ?? { assigned: 0, activity: 0, available: 0 }}
          target={env.targetByCategory.get(detailCat.id) ?? 0}
          targetInfo={env.targetInfoByCategory.get(detailCat.id)}
          suggested={suggestedByCategory.get(detailCat.id) ?? 0}
          month={month}
          lastMonth={env.lastMonthStats(detailCat.id)}
          transactions={env.transactionsForCategory(detailCat.id)}
          otherCategories={expenseCats.filter((c) => c.id !== detailCat.id)}
          editable={editable}
          isFeatured={prefs.featured_category_id === detailCat.id}
          isHidden={hiddenIds.has(detailCat.id)}
          format={format}
          onClose={() => setDetailCat(null)}
          onAssign={(n) => assignOne(detailCat.id, n)}
          onSetTarget={(amount, cadence, date, targetType) => saveTarget.mutate({ categoryId: detailCat.id, amount, cadence, date, targetType })}
          onToggleFeatured={() => updatePrefs.mutate({ featured_category_id: prefs.featured_category_id === detailCat.id ? undefined : detailCat.id })}
          onToggleHidden={() => toggleHidden(detailCat.id)}
          onMove={(toCat, amount) => moveMoney(detailCat.id, toCat, amount)}
          onRenameCategory={(name, icon) => renameCategory.mutate({ categoryId: detailCat.id, name, icon })}
          groups={groupCats}
          onMoveToGroup={(groupId) => moveToGroup.mutate({ categoryId: detailCat.id, groupId })}
        />
      )}

      {newCatOpen && (
        <NewCategorySheet
          groups={groupCats}
          onClose={() => setNewCatOpen(false)}
          onCreate={(name, icon, isGroup, parentId) => createCategory.mutate({ name, icon, isGroup, parentId })}
        />
      )}

      {newViewOpen && (
        <NewViewSheet
          categories={expenseCats}
          savedViews={savedViews}
          onClose={() => setNewViewOpen(false)}
          onCreate={(name, categoryIds) => createView.mutate({ name, categoryIds })}
          onDelete={(id) => deleteView.mutate(id)}
        />
      )}

      {prioritiesOpen && (
        <PrioritiesSheet
          categories={expenseCats}
          selected={priorityIds}
          onClose={() => setPrioritiesOpen(false)}
          onSave={(ids) => updatePrefs.mutate({ priority_category_ids: ids })}
        />
      )}
    </div>
  );
}
