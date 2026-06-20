'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { useFx } from '@/hooks/useFx';
import { useEnvelope, type EnvelopeCategory, type EnvelopeDetailTx, type UseEnvelopeResult, type TargetInfo, type AutoAssignStrategy } from '@/hooks/useEnvelope';
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
function fmtCell(n: number): string {
  return Math.round(n).toLocaleString('es-AR');
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

function fmtGoalDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-AR', { month: 'short', year: 'numeric' });
}

// Available colour with YNAB target awareness:
//   red    = overspent (negative)
//   yellow = funded but below the monthly target
//   green  = funded (and at/above target if there is one)
//   grey   = zero with no target
function availColor(available: number, target: number): string {
  if (available < 0) return '#E5604C';
  if (target > 0 && available < target) return '#C79A2B';
  if (available > 0) return '#5BA886';
  return '#A89B8C';
}

// The available "pill": a solid green capsule when funded (the happy state
// pops), a soft tint for the warning/zero states.
function availPill(available: number, target: number): { bg: string; fg: string } {
  const c = availColor(available, target);
  if (c === '#5BA886') return { bg: '#5BA886', fg: '#FFFFFF' }; // funded → filled green
  const bg = c === '#E5604C' ? '#FFE7E2' : c === '#C79A2B' ? '#FBF0D6' : '#ECE5DC';
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
  format,
  onClose,
  onAssign,
  onSetTarget,
  onToggleFeatured,
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
  format: (ars: number) => string;
  onClose: () => void;
  onAssign: (n: number) => void;
  onSetTarget: (amount: number, cadence: 'monthly' | 'by_date' | 'weekly', date: string | null, targetType: 'refill' | 'set_aside') => void;
  onToggleFeatured: () => void;
  onMove: (toCategoryId: string, amount: number) => void;
  onRenameCategory: (name: string, icon: string) => void;
  groups: EnvelopeCategory[];
  onMoveToGroup: (groupId: string | null) => void;
}) {
  const [moveTo, setMoveTo] = useState('');
  const [moveAmt, setMoveAmt] = useState(0);
  const [tMode, setTMode] = useState<'monthly' | 'by_date' | 'weekly'>(targetInfo?.cadence ?? 'monthly');
  const [tType, setTType] = useState<'refill' | 'set_aside'>(targetInfo?.targetType ?? 'refill');
  const [tAmt, setTAmt] = useState(targetInfo?.totalArs ?? 0);
  const [tDate, setTDate] = useState(targetInfo?.targetDate ?? '');
  const [editingName, setEditingName] = useState(false);
  const [cName, setCName] = useState(category.name);
  const [cIcon, setCIcon] = useState(category.icon);
  const fg = availColor(row.available, target);
  const toTarget = target > 0 ? target - row.available : 0;
  // Balance breakdown (YNAB style): what carried over vs what moved this month.
  const carryover = row.available - row.assigned + row.activity;
  const prevLabel = monthLabel(shiftMonth(month, -1));
  const curLabel = monthLabel(month);

  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: 'rgba(45,45,45,0.4)' }} onClick={onClose}>
      <div
        className="w-full rounded-t-3xl p-6 max-h-[88vh] overflow-y-auto"
        style={{ background: '#FFFFFF', paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: '#ECE5DC' }} />
        <div className="flex items-center gap-2 mb-4">
          <span className="text-2xl">{category.icon}</span>
          <h2 className="text-lg font-black flex-1 min-w-0 truncate" style={{ color: '#2D2D2D' }}>{category.name}</h2>
          {editable && (
            <button onClick={() => { setCName(category.name); setCIcon(category.icon); setEditingName((v) => !v); }} className="text-xs font-bold px-2 py-1 rounded-lg shrink-0" style={{ background: '#F9F5F0', color: '#6B6459' }}>✏️ Editar</button>
          )}
        </div>
        {editingName && editable && (
          <div className="flex gap-2 mb-4">
            <input value={cIcon} onChange={(e) => setCIcon(e.target.value)} maxLength={2} className="w-12 text-center rounded-xl border-2 outline-none py-2 text-lg" style={{ borderColor: '#ECE5DC', background: '#F9F5F0' }} />
            <input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="Nombre" className="flex-1 rounded-xl border-2 outline-none px-3 text-sm font-bold" style={{ borderColor: '#ECE5DC', background: '#F9F5F0', color: '#2D2D2D' }} />
            <button onClick={() => { if (cName.trim()) { onRenameCategory(cName.trim(), cIcon || category.icon); setEditingName(false); } }} className="px-4 rounded-xl text-sm font-bold text-white" style={{ background: '#7EC8A4' }}>OK</button>
          </div>
        )}
        {editingName && editable && groups.length > 0 && (
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs font-bold shrink-0" style={{ color: '#6B6459' }}>Grupo</span>
            <select
              value={category.parent_id ?? ''}
              onChange={(e) => onMoveToGroup(e.target.value || null)}
              className="flex-1 rounded-xl border-2 outline-none px-3 py-2 text-sm font-bold bg-white"
              style={{ borderColor: '#ECE5DC', color: '#2D2D2D' }}
            >
              <option value="">Sin grupo</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.icon} {g.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Balance breakdown (YNAB style) */}
        <p className="text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: '#6B6459' }}>Balance</p>
        <div className="rounded-2xl overflow-hidden mb-4" style={{ background: '#F9F5F0' }}>
          {[
            { l: `Desde ${prevLabel}`, v: format(carryover) },
            { l: `Asignado en ${curLabel}`, v: format(row.assigned) },
            { l: `Actividad en ${curLabel}`, v: format(-row.activity) },
          ].map((r, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3" style={{ borderTop: i > 0 ? '1px solid #ECE5DC' : 'none' }}>
              <span className="text-sm" style={{ color: '#6B6459' }}>{r.l}</span>
              <span className="text-sm font-bold tabular-nums" style={{ color: '#2D2D2D' }}>{r.v}</span>
            </div>
          ))}
          <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: '1px solid #ECE5DC' }}>
            <span className="text-sm font-bold" style={{ color: '#2D2D2D' }}>Disponible</span>
            <span className="text-sm font-black px-2.5 py-1 rounded-full tabular-nums" style={{ background: availPill(row.available, target).bg, color: availPill(row.available, target).fg }}>{format(row.available)}</span>
          </div>
        </div>

        {/* Goal/target status */}
        {targetInfo && (
          <div className="rounded-2xl p-4 mb-4 text-center" style={{ background: targetInfo.neededThisMonth <= 0 ? '#E4F2EA' : '#F9F5F0' }}>
            {targetInfo.cadence === 'by_date' ? (
              row.available >= targetInfo.totalArs && targetInfo.totalArs > 0 ? (
                <p className="text-sm font-bold" style={{ color: '#5BA886' }}>✓ ¡Meta cumplida!</p>
              ) : (
                <p className="text-sm" style={{ color: '#6B6459' }}>
                  Faltan <b>{format(targetInfo.totalArs - row.available)}</b>{targetInfo.targetDate ? ` para ${fmtGoalDate(targetInfo.targetDate)}` : ''} · necesitás <b style={{ color: '#C79A2B' }}>{format(targetInfo.neededThisMonth)}</b> este mes
                </p>
              )
            ) : (
              <p className="text-sm" style={{ color: '#6B6459' }}>
                {targetInfo.cadence === 'weekly' ? 'Meta semanal ' : 'Meta mensual '}{format(targetInfo.totalArs)}
                {targetInfo.neededThisMonth > 0
                  ? <> · {targetInfo.targetType === 'set_aside' ? 'falta apartar' : 'faltan'} <b style={{ color: '#C79A2B' }}>{format(targetInfo.neededThisMonth)}</b> este mes</>
                  : <span style={{ color: '#5BA886' }}> · al día este mes ✓</span>}
              </p>
            )}
          </div>
        )}

        {editable && (
          <>
            {/* Assigned editor */}
            <p className="text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: '#6B6459' }}>Asignado este mes</p>
            <MoneyField
              key={`a-${row.assigned}`}
              value={row.assigned}
              onCommit={onAssign}
              placeholder="0"
              className="w-full rounded-2xl px-4 py-3 text-lg font-bold mb-3 outline-none border-2"
              style={{ background: '#F9F5F0', color: '#2D2D2D', borderColor: '#ECE5DC' }}
            />

            {/* Quick actions */}
            <div className="flex flex-wrap gap-2 mb-4">
              {row.available < 0 && (
                <button
                  onClick={() => onAssign(row.assigned - row.available)}
                  className="text-xs font-bold px-3 py-2 rounded-xl"
                  style={{ background: '#FFE7E2', color: '#E5604C' }}
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
                  style={{ background: '#F1F7F4', color: '#5BA886' }}
                >
                  Asignaste el mes pasado {format(lastMonth.assigned)}
                </button>
              )}
              {lastMonth.activity > 0 && (
                <button
                  onClick={() => onAssign(lastMonth.activity)}
                  className="text-xs font-bold px-3 py-2 rounded-xl"
                  style={{ background: '#F9F5F0', color: '#6B6459' }}
                >
                  Gastaste el mes pasado {format(lastMonth.activity)}
                </button>
              )}
            </div>

            {/* Target — monthly amount or a by-date savings goal */}
            <p className="text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: '#6B6459' }}>Meta</p>
            <div className="flex rounded-xl overflow-hidden mb-2 p-1 gap-1" style={{ background: '#ECE5DC' }}>
              {([{ k: 'monthly', l: 'Mensual' }, { k: 'weekly', l: 'Semanal' }, { k: 'by_date', l: 'Por fecha' }] as const).map((o) => (
                <button key={o.k} onClick={() => setTMode(o.k)} className="flex-1 py-1.5 text-xs font-bold rounded-lg" style={{ background: tMode === o.k ? '#FFFFFF' : 'transparent', color: tMode === o.k ? '#2D2D2D' : '#6B6459' }}>{o.l}</button>
              ))}
            </div>
            {tMode !== 'by_date' && (
              <div className="flex rounded-xl overflow-hidden mb-2 p-1 gap-1" style={{ background: '#ECE5DC' }}>
                {([{ k: 'refill', l: 'Rellenar hasta' }, { k: 'set_aside', l: 'Apartar' }] as const).map((o) => (
                  <button key={o.k} onClick={() => setTType(o.k)} className="flex-1 py-1.5 text-[11px] font-bold rounded-lg" style={{ background: tType === o.k ? '#FFFFFF' : 'transparent', color: tType === o.k ? '#2D2D2D' : '#6B6459' }}>{o.l}</button>
                ))}
              </div>
            )}
            <p className="text-[11px] mb-1.5" style={{ color: '#6B6459' }}>
              {tMode === 'by_date'
                ? 'Total a juntar para una fecha (meta de ahorro).'
                : `${tMode === 'weekly' ? 'Monto por semana' : 'Monto por mes'}. ${tType === 'refill' ? 'Rellenar = llevar el disponible hasta ese monto.' : 'Apartar = asignar ese monto de nuevo cada período.'}`}
            </p>
            {suggested > 0 && tMode === 'monthly' && (
              <button onClick={() => setTAmt(suggested)} className="text-xs font-bold px-3 py-2 rounded-xl mb-2" style={{ background: '#E7EFFB', color: '#5B8DEF' }}>
                ✨ Sugerido {format(suggested)} (según tu gasto)
              </button>
            )}
            <MoneyInput
              value={tAmt}
              onChange={setTAmt}
              placeholder="0"
              className="w-full rounded-2xl px-4 py-3 text-base font-bold mb-2 outline-none border-2"
              style={{ background: '#F9F5F0', color: '#2D2D2D', borderColor: '#ECE5DC' }}
            />
            {tMode === 'by_date' && (
              <input
                type="date"
                value={tDate}
                onChange={(e) => setTDate(e.target.value)}
                className="w-full rounded-2xl px-4 py-3 text-base font-bold mb-2 outline-none border-2"
                style={{ background: '#F9F5F0', color: '#2D2D2D', borderColor: '#ECE5DC' }}
              />
            )}
            <button onClick={() => onSetTarget(tAmt, tMode, tMode === 'by_date' ? (tDate || null) : null, tType)} className="w-full py-2.5 rounded-xl text-sm font-bold text-white mb-4" style={{ background: '#7EC8A4' }}>
              Guardar meta
            </button>

            {/* Feature this category as the Home goal */}
            <button onClick={onToggleFeatured} className="w-full py-2.5 rounded-xl text-sm font-bold mb-4" style={{ background: isFeatured ? '#E4F2EA' : '#F9F5F0', color: isFeatured ? '#5BA886' : '#6B6459' }}>
              {isFeatured ? '📌 Destacada en Home' : '📌 Destacar en Home'}
            </button>

            {/* Move money to another envelope */}
            <p className="text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: '#6B6459' }}>Mover plata a otro sobre</p>
            <div className="flex gap-2 mb-5">
              <select
                value={moveTo}
                onChange={(e) => setMoveTo(e.target.value)}
                className="flex-1 rounded-xl px-3 py-2 text-sm outline-none border"
                style={{ background: '#F9F5F0', color: '#2D2D2D', borderColor: '#ECE5DC' }}
              >
                <option value="">Elegí un sobre…</option>
                {otherCategories.map((c) => (
                  <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                ))}
              </select>
              <MoneyInput
                value={moveAmt}
                onChange={setMoveAmt}
                placeholder="Monto"
                className="w-24 rounded-xl px-3 py-2 text-sm font-bold outline-none border text-right"
                style={{ background: '#F9F5F0', color: '#2D2D2D', borderColor: '#ECE5DC' }}
              />
              <button
                onClick={() => { if (moveTo && moveAmt > 0) { onMove(moveTo, moveAmt); setMoveTo(''); setMoveAmt(0); } }}
                disabled={!moveTo || moveAmt <= 0}
                className="px-3 py-2 rounded-xl text-sm font-bold text-white"
                style={{ background: !moveTo || moveAmt <= 0 ? '#C4B9AE' : '#7EC8A4' }}
              >
                Mover
              </button>
            </div>
          </>
        )}

        {/* This month's transactions */}
        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#6B6459' }}>
          Movimientos del mes · {transactions.length}
        </p>
        {transactions.length === 0 ? (
          <p className="text-sm py-4 text-center" style={{ color: '#6B6459' }}>Sin gastos este mes.</p>
        ) : (
          <div className="rounded-2xl overflow-hidden" style={{ background: '#F9F5F0' }}>
            {transactions.map((t, i) => (
              <div key={t.id} className="flex items-center gap-3 px-4 py-3" style={{ borderTop: i > 0 ? '1px solid #ECE5DC' : 'none' }}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: '#2D2D2D' }}>{t.merchant || category.name}</p>
                  <p className="text-xs" style={{ color: '#6B6459' }}>
                    {fmtDate(t.occurred_on)}{t.shared ? ' · compartido' : ''}{t.fixed ? ' · 📌 fijo' : ''}
                  </p>
                </div>
                <p className="text-base font-black" style={{ color: '#FF7F6B', fontVariantNumeric: 'tabular-nums' }}>-{format(t.amountArs)}</p>
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

function NewCategorySheet({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, icon: string, isGroup: boolean) => void }) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('🏷️');
  const [isGroup, setIsGroup] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: 'rgba(45,45,45,0.4)' }} onClick={onClose}>
      <div
        className="w-full rounded-t-3xl p-6"
        style={{ background: '#FFFFFF', paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: '#ECE5DC' }} />
        <h2 className="text-lg font-black mb-4" style={{ color: '#2D2D2D' }}>Nueva categoría</h2>

        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#6B6459' }}>Nombre</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej: Gimnasio"
          autoFocus
          className="w-full rounded-2xl px-4 py-3 text-base font-bold mb-4 outline-none border-2"
          style={{ background: '#F9F5F0', color: '#2D2D2D', borderColor: name ? '#7EC8A4' : '#ECE5DC' }}
        />

        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#6B6459' }}>Ícono</p>
        <div className="flex flex-wrap gap-2 mb-5">
          {CATEGORY_ICONS.map((ic) => (
            <button
              key={ic}
              onClick={() => setIcon(ic)}
              className="w-10 h-10 rounded-xl text-xl flex items-center justify-center"
              style={{ background: icon === ic ? '#7EC8A4' : '#F9F5F0', outline: icon === ic ? '2px solid #5BA886' : 'none' }}
            >
              {ic}
            </button>
          ))}
        </div>

        <button
          onClick={() => setIsGroup((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 rounded-2xl mb-4 border-2"
          style={{ background: isGroup ? '#E4F2EA' : '#F9F5F0', borderColor: isGroup ? '#7EC8A4' : '#ECE5DC' }}
        >
          <span className="text-sm font-bold" style={{ color: '#2D2D2D' }}>📂 Es un grupo (encabezado)</span>
          <span className="text-xs font-bold" style={{ color: isGroup ? '#5BA886' : '#6B6459' }}>{isGroup ? 'Sí' : 'No'}</span>
        </button>
        <p className="text-[11px] mb-4 -mt-2" style={{ color: '#6B6459' }}>Un grupo agrupa categorías (no se le asigna plata).</p>

        <button
          onClick={() => { if (name.trim()) { onCreate(name.trim(), icon, isGroup); onClose(); } }}
          disabled={!name.trim()}
          className="w-full py-4 rounded-2xl font-bold text-white"
          style={{ background: name.trim() ? '#7EC8A4' : '#C4B9AE' }}
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
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: 'rgba(45,45,45,0.4)' }} onClick={onClose}>
      <div className="w-full rounded-t-3xl p-6 max-h-[88vh] overflow-y-auto" style={{ background: '#FFFFFF', paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }} onClick={(e) => e.stopPropagation()}>
        <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: '#ECE5DC' }} />
        <h2 className="text-lg font-black mb-4" style={{ color: '#2D2D2D' }}>Vistas guardadas</h2>

        {savedViews.length > 0 && (
          <div className="rounded-2xl overflow-hidden mb-5" style={{ background: '#F9F5F0' }}>
            {savedViews.map((v, i) => (
              <div key={v.id} className="flex items-center gap-3 px-4 py-3" style={{ borderTop: i > 0 ? '1px solid #ECE5DC' : 'none' }}>
                <span className="flex-1 text-sm font-semibold" style={{ color: '#2D2D2D' }}>⭐ {v.name}</span>
                <span className="text-[11px]" style={{ color: '#6B6459' }}>{v.category_ids.length} cat.</span>
                <button onClick={() => onDelete(v.id)} className="text-xs font-bold px-2 py-1 rounded-lg" style={{ background: '#FFE7E2', color: '#E5604C' }}>Borrar</button>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#6B6459' }}>Nueva vista</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej: Comida, Compartido con pareja…"
          className="w-full rounded-2xl px-4 py-3 text-base font-bold mb-4 outline-none border-2"
          style={{ background: '#F9F5F0', color: '#2D2D2D', borderColor: name ? '#7EC8A4' : '#ECE5DC' }}
        />
        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#6B6459' }}>Categorías ({picked.size})</p>
        <div className="flex flex-col gap-1 mb-5 max-h-64 overflow-y-auto">
          {categories.map((c) => (
            <button key={c.id} onClick={() => toggle(c.id)} className="flex items-center gap-3 px-3 py-2 rounded-xl" style={{ background: picked.has(c.id) ? '#E4F2EA' : '#F9F5F0' }}>
              <span className="w-4 h-4 rounded-full shrink-0 flex items-center justify-center text-[10px] text-white" style={{ background: picked.has(c.id) ? '#5BA886' : '#C4B9AE' }}>{picked.has(c.id) ? '✓' : ''}</span>
              <span className="text-lg">{c.icon}</span>
              <span className="text-sm font-semibold truncate" style={{ color: '#2D2D2D' }}>{c.name}</span>
            </button>
          ))}
        </div>
        <button
          onClick={() => { if (name.trim() && picked.size) { onCreate(name.trim(), [...picked]); onClose(); } }}
          disabled={!name.trim() || picked.size === 0}
          className="w-full py-4 rounded-2xl font-bold text-white"
          style={{ background: name.trim() && picked.size ? '#7EC8A4' : '#C4B9AE' }}
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
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: 'rgba(45,45,45,0.4)' }} onClick={onClose}>
      <div className="w-full rounded-t-3xl p-6 max-h-[88vh] overflow-y-auto" style={{ background: '#FFFFFF', paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }} onClick={(e) => e.stopPropagation()}>
        <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: '#ECE5DC' }} />
        <h2 className="text-lg font-black mb-1" style={{ color: '#2D2D2D' }}>Prioridades del mes</h2>
        <p className="text-sm mb-4" style={{ color: '#6B6459' }}>¿Qué es lo importante este mes? Fijalo arriba para tenerlo a mano.</p>
        <div className="flex flex-col gap-1 mb-5">
          {categories.map((c) => (
            <button key={c.id} onClick={() => toggle(c.id)} className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ background: picked.has(c.id) ? '#E4F2EA' : '#F9F5F0' }}>
              <span className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[11px] text-white" style={{ background: picked.has(c.id) ? '#5BA886' : '#C4B9AE' }}>{picked.has(c.id) ? '✓' : ''}</span>
              <span className="text-lg">{c.icon}</span>
              <span className="text-sm font-semibold truncate" style={{ color: '#2D2D2D' }}>{c.name}</span>
            </button>
          ))}
        </div>
        <button onClick={() => { onSave([...picked]); onClose(); }} className="w-full py-4 rounded-2xl font-bold text-white" style={{ background: '#7EC8A4' }}>Listo</button>
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
    const target = env.targetByCategory.get(r.categoryId) ?? 0;
    if (r.available < 0) alerts.push({ cat, over: true, amount: -r.available });
    else if (target > 0 && r.available < target) alerts.push({ cat, over: false, amount: target - r.available });
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
    const target = env.targetByCategory.get(cat.id) ?? 0;
    const pill = availPill(available, target);
    return (
      <div className="flex items-center gap-3 rounded-2xl px-4 py-3" style={{ background: '#FFFFFF' }}>
        <span className="text-lg">{cat.icon}</span>
        <span className="flex-1 min-w-0 text-sm font-semibold truncate" style={{ color: '#2D2D2D' }}>{cat.name}</span>
        <span className="text-xs font-black px-2.5 py-1 rounded-full tabular-nums" style={{ background: pill.bg, color: pill.fg }}>{format(available)}</span>
      </div>
    );
  };

  return (
    <div className="px-4 flex flex-col gap-5">
      {/* Top Priorities */}
      <section>
        <div className="flex items-center justify-between mb-2 px-1">
          <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#6B6459' }}>Prioridades</p>
          {editable && <button onClick={onAdjustPriorities} className="text-xs font-bold" style={{ color: '#5B8DEF' }}>Ajustar</button>}
        </div>
        {priorities.length > 0 ? (
          <div className="flex flex-col gap-2">{priorities.map((c) => <PriorityRow key={c.id} cat={c} />)}</div>
        ) : (
          <button onClick={editable ? onAdjustPriorities : undefined} className="w-full rounded-2xl p-4 text-center text-sm" style={{ background: '#FFFFFF', color: '#6B6459' }}>
            Fijá tus categorías importantes para tenerlas a mano.
          </button>
        )}
      </section>

      {/* Cost to Be Me */}
      <section className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
        <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#6B6459' }}>Lo que cuesta un mes de vos</p>
        <p className="text-3xl font-black mt-0.5" style={{ color: '#2D2D2D', fontVariantNumeric: 'tabular-nums' }}>{format(costToBeMe)}</p>
        <p className="text-[11px] mb-3" style={{ color: '#6B6459' }}>Suma de todas tus metas del mes.</p>
        <div className="h-2.5 rounded-full overflow-hidden mb-1" style={{ background: '#ECE5DC' }}>
          <div className="h-full rounded-full" style={{ width: `${incomePct * 100}%`, background: incomePct >= 1 ? '#E5604C' : '#7EC8A4' }} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px]" style={{ color: '#6B6459' }}>Ingreso esperado</span>
          {editable ? (
            <MoneyField
              key={`inc-${expectedIncome}`}
              value={expectedIncome}
              onCommit={onSetExpectedIncome}
              placeholder="0"
              className="w-28 bg-transparent text-right text-sm font-bold tabular-nums outline-none rounded px-1 border-b border-dashed border-[#D9CFC2] focus:border-[#7EC8A4]"
              style={{ color: '#2D2D2D' }}
            />
          ) : (
            <span className="text-sm font-bold tabular-nums" style={{ color: '#2D2D2D' }}>{format(expectedIncome)}</span>
          )}
        </div>
      </section>

      {/* Age of Money */}
      {env.ageOfMoney != null && (
        <section className="rounded-3xl p-5 flex items-center gap-4" style={{ background: '#FFFFFF' }}>
          <span className="text-3xl shrink-0">🕰️</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#6B6459' }}>Antigüedad del dinero</p>
            <p className="text-2xl font-black leading-tight" style={{ color: '#2D2D2D' }}>{env.ageOfMoney} días</p>
            <p className="text-[11px]" style={{ color: '#6B6459' }}>
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
          <p className="text-xs font-bold uppercase tracking-wide mb-2 px-1" style={{ color: '#6B6459' }}>Metas de ahorro</p>
          <div className="flex flex-col gap-2">
            {savingsGoals.map((g) => {
              const pct = g.info.pctComplete;
              return (
                <div key={g.cat.id} className="rounded-3xl p-4 flex items-center gap-4" style={{ background: '#FFFFFF' }}>
                  <div className="relative w-14 h-14 shrink-0">
                    <svg viewBox="0 0 36 36" className="w-14 h-14 -rotate-90">
                      <circle cx="18" cy="18" r="15.9" fill="none" stroke="#ECE5DC" strokeWidth="4" />
                      <circle cx="18" cy="18" r="15.9" fill="none" stroke="#7EC8A4" strokeWidth="4" strokeDasharray={`${pct * 100} 100`} strokeLinecap="round" />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-[11px] font-black" style={{ color: '#2D2D2D' }}>{Math.round(pct * 100)}%</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black truncate" style={{ color: '#2D2D2D' }}>{g.cat.icon} {g.cat.name}</p>
                    <p className="text-xs tabular-nums" style={{ color: '#6B6459' }}>{format(g.available)} de {format(g.info.totalArs)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Monthly Summary */}
      <section>
        <p className="text-xs font-bold uppercase tracking-wide mb-2 px-1" style={{ color: '#6B6459' }}>Resumen del mes</p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Metas totales', value: s.totalTargets, color: '#2D2D2D' },
            { label: 'Sin financiar', value: s.underfunded, color: s.underfunded > 0 ? '#C79A2B' : '#5BA886' },
            { label: 'Asignado', value: s.assigned, color: '#2D2D2D' },
            { label: 'Gastado', value: s.spent, color: '#FF7F6B' },
          ].map((c) => (
            <div key={c.label} className="rounded-2xl p-4" style={{ background: '#FFFFFF' }}>
              <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: '#6B6459' }}>{c.label}</p>
              <p className="text-lg font-black tabular-nums" style={{ color: c.color }}>{format(c.value)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Assigned in Future Months */}
      <section>
        <p className="text-xs font-bold uppercase tracking-wide mb-2 px-1" style={{ color: '#6B6459' }}>Asignado en meses futuros</p>
        <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
          <div className="flex items-center gap-3 mb-3">
            <div className="relative w-14 h-14 shrink-0">
              <svg viewBox="0 0 36 36" className="w-14 h-14 -rotate-90">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#ECE5DC" strokeWidth="4" />
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#7EC8A4" strokeWidth="4" strokeDasharray={`${nextFundedPct * 100} 100`} strokeLinecap="round" />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-[11px] font-black" style={{ color: '#2D2D2D' }}>{Math.round(nextFundedPct * 100)}%</span>
            </div>
            <p className="text-xs" style={{ color: '#6B6459' }}>El mes que viene está financiado al <b>{Math.round(nextFundedPct * 100)}%</b> de tus metas. Asigná hacia adelante para adelantarte un mes.</p>
          </div>
          {env.assignedFutureByMonth.length === 0 ? (
            <p className="text-sm text-center py-2" style={{ color: '#6B6459' }}>Todavía no asignaste a meses futuros.</p>
          ) : (
            <div className="flex flex-col">
              {env.assignedFutureByMonth.map((m, i) => (
                <button key={m.month} onClick={() => onGotoMonth(m.month)} className="flex items-center justify-between py-2.5" style={{ borderTop: i > 0 ? '1px solid #F1ECE4' : 'none' }}>
                  <span className="text-sm font-semibold" style={{ color: '#2D2D2D' }}>{monthLabel(m.month)}</span>
                  <span className="text-sm font-black tabular-nums" style={{ color: '#5BA886' }}>{format(m.assigned)} ›</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Prioritized alerts */}
      {alerts.length > 0 && (
        <section>
          <p className="text-xs font-bold uppercase tracking-wide mb-2 px-1" style={{ color: '#6B6459' }}>Qué atacar primero</p>
          <div className="rounded-3xl overflow-hidden" style={{ background: '#FFFFFF' }}>
            {alerts.map((a, i) => (
              <div key={a.cat.id} className="flex items-center gap-3 px-4 py-3" style={{ borderTop: i > 0 ? '1px solid #F1ECE4' : 'none' }}>
                <span className="text-lg">{a.cat.icon}</span>
                <span className="flex-1 min-w-0 text-sm font-semibold truncate" style={{ color: '#2D2D2D' }}>{a.cat.name}</span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={a.over ? { background: '#FFE7E2', color: '#E5604C' } : { background: '#FBF0D6', color: '#C79A2B' }}>
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
    const ORDER = ['Fijos', 'Variables', 'Ocio', 'Ahorro y metas'];
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
  type Prefs = { priority_category_ids?: string[]; expected_income?: number; featured_category_id?: string };
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
    if (filter === 'overspent') return available < 0;
    if (filter === 'underfunded') return target > 0 && available >= 0 && available < target;
    if (filter === 'overfunded') return target > 0 && available > target;
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
    mutationFn: async ({ name, icon, isGroup }: { name: string; icon: string; isGroup?: boolean }) => {
      const { error } = await supabase
        .from('categories')
        .insert({ household_id: profile.household_id, name, icon, kind: 'expense', is_default: false, is_group: !!isGroup });
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
      if (a < 0) overspent++;
      else if (t > 0 && a < t) underfunded++;
      if (t > 0 && a > t) overfunded++;
      if (a > 0) available++;
    }
    return { overspent, underfunded, overfunded, available };
  }, [expenseCats, env.rowByCategory, env.targetByCategory]);

  const rta = env.readyToAssign;
  const rtaColor = rta > 0 ? '#5BA886' : rta < 0 ? '#E5604C' : '#6B6459';
  const rtaBg = rta > 0 ? '#E4F2EA' : rta < 0 ? '#FFE7E2' : '#FFFFFF';

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
    <div className="min-h-screen pb-24" style={{ background: '#F9F5F0' }}>
      <header className="px-5 pt-14 pb-3">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-black" style={{ color: '#2D2D2D' }}>Presupuesto</h1>
          <div className="flex items-center gap-1">
            <button onClick={() => setMonth((m) => shiftMonth(m, -1))} className="w-8 h-8 rounded-full text-lg flex items-center justify-center" style={{ background: '#FFFFFF', color: '#6B6459' }} aria-label="Mes anterior">‹</button>
            <span className="text-sm font-bold min-w-[7.5rem] text-center" style={{ color: '#2D2D2D' }}>{monthLabel(month)}</span>
            <button onClick={() => setMonth((m) => shiftMonth(m, 1))} className="w-8 h-8 rounded-full text-lg flex items-center justify-center" style={{ background: '#FFFFFF', color: '#6B6459' }} aria-label="Mes siguiente">›</button>
          </div>
        </div>
      </header>

      {partner && (
        <div className="mx-4 mb-3 flex rounded-2xl overflow-hidden p-1 gap-1" style={{ background: '#ECE5DC' }}>
          {([{ k: 'mine', label: 'Mío' }, { k: 'partner', label: partner.nickname || 'Pareja' }] as const).map((t) => (
            <button key={t.k} onClick={() => setView(t.k)} className="flex-1 py-1.5 text-xs font-bold rounded-xl transition-colors" style={{ background: view === t.k ? '#FFFFFF' : 'transparent', color: view === t.k ? '#2D2D2D' : '#6B6459' }}>{t.label}</button>
          ))}
        </div>
      )}

      {/* "Para asignar" banner + quick actions (scrolls with the page) */}
      <div className="mx-4 mb-4 rounded-3xl p-5" style={{ background: rtaBg, boxShadow: '0 6px 20px -12px rgba(45,45,45,0.5)' }}>
        <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#6B6459' }}>
          {editable ? 'Para asignar' : `Para asignar · ${partner?.nickname || 'Pareja'}`}
        </p>
        <p className="text-3xl font-black mt-0.5" style={{ color: rtaColor, fontVariantNumeric: 'tabular-nums' }}>{format(rta)}</p>
        <p className="text-[11px] mt-1" style={{ color: '#6B6459' }}>
          {rta > 0 ? 'Plata en cuentas todavía sin un trabajo. Asignala a un sobre.' : rta < 0 ? 'Asignaste (o fronteaste) más de lo que tenés. Sacá de algún sobre.' : 'Cada peso tiene un trabajo. 🎉'}
        </p>
        <p className="text-[11px] mt-1.5" style={{ color: '#A89B8C' }}>Efectivo on-budget {format(env.cash)} · Asignado este mes {format(env.assignedTotal)}</p>
        {editable && overspentCount >= 4 && (
          <p className="text-[11px] mt-2 leading-snug" style={{ color: '#6B6459' }}>
            Empezaste a presupuestar a mitad de mes. Tocá <b>Cubrir lo ya gastado</b> para asignar
            retroactivamente lo que ya saliste gastando y partir en cero (no te baja “Para asignar”).
          </p>
        )}
        {editable && (
          <div className="mt-3">
            <div className="flex flex-wrap gap-2">
              {overspentCount > 0 && (
                <button onClick={coverOverspent} className="text-xs font-bold px-3 py-2 rounded-xl" style={{ background: '#FFE7E2', color: '#E5604C' }}>
                  Cubrir lo ya gastado ({overspentCount})
                </button>
              )}
              {underfundedCount > 0 && (
                <button onClick={autoAssignTargets} className="text-xs font-bold px-3 py-2 rounded-xl" style={{ background: '#FDF1D8', color: '#B8860B' }}>
                  Asignar a metas ({underfundedCount})
                </button>
              )}
              <button onClick={() => setAutoMenuOpen((v) => !v)} className="text-xs font-bold px-3 py-2 rounded-xl" style={{ background: '#E4F2EA', color: '#5BA886' }}>
                ⚡ Auto-asignar {autoMenuOpen ? '▴' : '▾'}
              </button>
            </div>
            {autoMenuOpen && (
              <div className="mt-2 flex flex-col gap-1 rounded-2xl p-2" style={{ background: '#F9F5F0' }}>
                {([
                  { k: 'last_assigned', label: 'Igual que el mes pasado (asignado)' },
                  { k: 'last_spent', label: 'Gastado el mes pasado' },
                  { k: 'avg3_spent', label: 'Promedio de gasto (3 meses)' },
                  { k: 'reset_available', label: 'Resetear disponible a 0' },
                ] as const).map((o) => (
                  <button key={o.k} onClick={() => applyAutoAssign(o.k)} className="text-left text-xs font-semibold px-3 py-2 rounded-xl" style={{ background: '#FFFFFF', color: '#2D2D2D' }}>
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Categorías | Spotlight toggle */}
      <div className="mx-4 mb-3 flex rounded-2xl overflow-hidden p-1 gap-1" style={{ background: '#ECE5DC' }}>
        {([{ k: 'categories', label: 'Categorías' }, { k: 'spotlight', label: '✨ Spotlight' }] as const).map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)} className="flex-1 py-1.5 text-xs font-bold rounded-xl transition-colors" style={{ background: tab === t.k ? '#FFFFFF' : 'transparent', color: tab === t.k ? '#2D2D2D' : '#6B6459' }}>{t.label}</button>
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
            className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-full whitespace-nowrap"
            style={{ background: filter === chip.k ? '#7EC8A4' : '#FFFFFF', color: filter === chip.k ? '#FFFFFF' : '#6B6459' }}
          >
            {chip.label}{chip.n != null && chip.n > 0 ? ` ${chip.n}` : ''}
          </button>
        ))}
        {savedViews.map((v) => (
          <button
            key={v.id}
            onClick={() => setFilter(`view:${v.id}`)}
            className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-full whitespace-nowrap"
            style={{ background: filter === `view:${v.id}` ? '#5B8DEF' : '#FFFFFF', color: filter === `view:${v.id}` ? '#FFFFFF' : '#6B6459' }}
          >
            ⭐ {v.name}
          </button>
        ))}
        {editable && (
          <button
            onClick={() => setNewViewOpen(true)}
            className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-full whitespace-nowrap border-2 border-dashed"
            style={{ borderColor: '#D9CFC2', color: '#6B6459', background: 'transparent' }}
          >
            + Vista
          </button>
        )}
      </div>

      <div className="px-4 flex flex-col gap-4">
        {env.isLoading ? (
          <div className="rounded-3xl p-8 text-center text-sm" style={{ background: '#FFFFFF', color: '#6B6459' }}>Cargando…</div>
        ) : (
          groups.map((g) => {
            const cats = g.cats.filter((c) => matchesFilter(c.id));
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
                  <span className="text-[10px]" style={{ color: '#6B6459' }}>{isCollapsed ? '▸' : '▾'}</span>
                  <p className="flex-1 text-left text-xs font-bold uppercase tracking-wide" style={{ color: '#6B6459' }}>{g.title}</p>
                  <span className="text-[12px] font-black tabular-nums" style={{ color: availColor(sub.available, 0) }}>{fmtCell(sub.available)}</span>
                </button>

                {!isCollapsed && (
                  <div className="rounded-3xl overflow-hidden" style={{ background: '#FFFFFF' }}>
                    {cats.map((c, i) => {
                      const row = env.rowByCategory.get(c.id);
                      const assigned = row?.assigned ?? 0;
                      const activity = row?.activity ?? 0;
                      const available = row?.available ?? 0;
                      const target = env.targetByCategory.get(c.id) ?? 0;
                      const fg = availColor(available, target);
                      // YNAB-style per-category bar: how "full" the envelope is
                      // toward its target (or its assignment when there's no
                      // target). Overspent shows a full red bar.
                      const denom = target > 0 ? target : assigned;
                      const barPct = available < 0 ? 100 : denom > 0 ? Math.max(0, Math.min(1, available / denom)) * 100 : 0;
                      // YNAB-style status text under the name.
                      let statusText = '';
                      let statusColor = '#6B6459';
                      if (available < 0) { statusText = `Sobregiraste ${fmtCell(-available)}`; statusColor = '#E5604C'; }
                      else if (target > 0 && available < target) { statusText = `Faltan ${fmtCell(target - available)}`; statusColor = '#C79A2B'; }
                      else if (target > 0) { statusText = '✓ Meta cumplida'; statusColor = '#5BA886'; }
                      else if (assigned <= 0 && activity <= 0) { statusText = ''; }
                      else if (activity <= 0) { statusText = 'Financiado'; statusColor = '#5BA886'; }
                      else if (available <= 0) { statusText = 'Gastado todo'; statusColor = '#6B6459'; }
                      else { statusText = `Gastaste ${fmtCell(activity)} de ${fmtCell(assigned)}`; statusColor = '#6B6459'; }
                      return (
                        <div
                          key={c.id}
                          onClick={() => setDetailCat(c)}
                          role="button"
                          tabIndex={0}
                          className="px-3 py-2.5 cursor-pointer"
                          style={{ borderTop: i > 0 ? '1px solid #F1ECE4' : 'none' }}
                        >
                          <div className="flex items-center gap-2">
                          <span className="relative shrink-0 text-lg">
                            {c.color && (
                              <span className="absolute -left-1 top-1 w-1.5 h-1.5 rounded-full" style={{ background: c.color }} />
                            )}
                            {c.icon}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate" style={{ color: '#2D2D2D' }}>{c.name}</p>
                            {statusText && (
                              <p className="text-[10px] font-semibold" style={{ color: statusColor }}>{statusText}</p>
                            )}
                            {/* Per-category bar: how full the envelope is (toward its
                                target, or its assignment). Shown on every row for a
                                consistent look; empty track when nothing's in it. */}
                            <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ background: '#F1ECE4' }}>
                              <div className="h-full rounded-full transition-all" style={{ width: `${barPct}%`, background: fg }} />
                            </div>
                          </div>
                          {/* YNAB mobile: only the Available pill; tap the row to assign. */}
                          <span className="shrink-0">
                            <span className="inline-block px-2.5 py-1 rounded-full text-sm font-black tabular-nums" style={{ background: availPill(available, target).bg, color: availPill(available, target).fg }}>
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
            style={{ borderColor: '#D9CFC2', color: '#6B6459', background: 'transparent' }}
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
          format={format}
          onClose={() => setDetailCat(null)}
          onAssign={(n) => assignOne(detailCat.id, n)}
          onSetTarget={(amount, cadence, date, targetType) => saveTarget.mutate({ categoryId: detailCat.id, amount, cadence, date, targetType })}
          onToggleFeatured={() => updatePrefs.mutate({ featured_category_id: prefs.featured_category_id === detailCat.id ? undefined : detailCat.id })}
          onMove={(toCat, amount) => moveMoney(detailCat.id, toCat, amount)}
          onRenameCategory={(name, icon) => renameCategory.mutate({ categoryId: detailCat.id, name, icon })}
          groups={groupCats}
          onMoveToGroup={(groupId) => moveToGroup.mutate({ categoryId: detailCat.id, groupId })}
        />
      )}

      {newCatOpen && (
        <NewCategorySheet
          onClose={() => setNewCatOpen(false)}
          onCreate={(name, icon, isGroup) => createCategory.mutate({ name, icon, isGroup })}
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
