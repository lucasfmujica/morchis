'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useDragToDismiss } from '@/hooks/useDragToDismiss';
import { MoneyInput } from '@/components/MoneyInput';
import { PrimaryButton } from '@/components/PrimaryButton';
import { createClient } from '@/lib/supabase';
import { formatARS, formatUSD } from '@/lib/format';
import { ITEM_GROUPS, groupMeta } from '@/lib/itemGroups';
import { toast } from 'sonner';

interface ReceiptItemsSheetProps {
  open: boolean;
  onClose: () => void;
  householdId: string;
  transactionId: string | null;
  merchant: string | null;
  total: number;
  currency: string;
  occurredOn: string;
}

// One editable line. `id` is null for rows added in this session (not yet in the
// DB); `key` is a stable client-side key for React lists.
interface EditItem {
  key: string;
  id: string | null;
  name: string;
  qty: number | null;
  line_total: number;
  group: string;
}

type ItemRow = {
  id: string;
  name: string;
  qty: number | null;
  line_total: number;
  item_group: string;
};

let tmpCounter = 0;
function tmpKey(): string {
  tmpCounter += 1;
  return `new-${tmpCounter}`;
}

export function ReceiptItemsSheet({
  open,
  onClose,
  householdId,
  transactionId,
  merchant,
  total,
  currency,
  occurredOn,
}: ReceiptItemsSheetProps) {
  const supabase = createClient();
  const qc = useQueryClient();
  const { dragY, dragging, handleProps } = useDragToDismiss(onClose);
  // `draft` holds the working copy while editing; read mode renders straight off
  // the fetched rows (deriving instead of mirroring keeps state in one place).
  const [draft, setDraft] = useState<EditItem[]>([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const fmt = (n: number) => (currency === 'USD' ? formatUSD(n) : formatARS(n));

  const { data: rows = [], isLoading } = useQuery<ItemRow[]>({
    queryKey: ['transaction-items', transactionId],
    enabled: open && !!transactionId,
    queryFn: async () => {
      const { data } = await supabase
        .from('transaction_items')
        .select('id, name, qty, line_total, item_group')
        .eq('transaction_id', transactionId!)
        .order('created_at', { ascending: true });
      return (data as ItemRow[]) ?? [];
    },
  });

  // The fetched rows as editable shapes — the baseline a fresh edit starts from.
  const baseItems = useMemo<EditItem[]>(
    () =>
      rows.map((r) => ({
        key: r.id,
        id: r.id,
        name: r.name,
        qty: r.qty,
        line_total: Number(r.line_total),
        group: r.item_group,
      })),
    [rows],
  );
  const items = editing ? draft : baseItems;

  function startEdit(seed: EditItem[]) {
    setDraft(seed);
    setEditing(true);
  }

  const itemsSum = useMemo(() => items.reduce((s, it) => s + it.line_total, 0), [items]);

  const groupTotals = useMemo(
    () =>
      ITEM_GROUPS.map((g) => ({
        g,
        total: items.filter((it) => it.group === g).reduce((s, it) => s + it.line_total, 0),
      }))
        .filter((x) => x.total > 0)
        .sort((a, b) => b.total - a.total),
    [items],
  );

  function updateItem(key: string, patch: Partial<EditItem>) {
    setDraft((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }
  function removeItem(key: string) {
    setDraft((prev) => prev.filter((it) => it.key !== key));
  }
  function addItem() {
    setDraft((prev) => [
      ...prev,
      { key: tmpKey(), id: null, name: '', qty: 1, line_total: 0, group: 'otros' },
    ]);
  }

  async function handleSave() {
    if (!transactionId) return;
    setSaving(true);
    try {
      const original = new Map(rows.map((r) => [r.id, r]));
      const currentIds = new Set(items.filter((it) => it.id).map((it) => it.id!));

      // Rows removed in the UI → delete from the DB.
      const toDelete = rows.filter((r) => !currentIds.has(r.id)).map((r) => r.id);
      if (toDelete.length > 0) {
        const { error } = await supabase.from('transaction_items').delete().in('id', toDelete);
        if (error) throw error;
      }

      // Existing rows that actually changed → update.
      for (const it of items) {
        if (!it.id) continue;
        const orig = original.get(it.id);
        if (
          orig &&
          orig.name === it.name &&
          Number(orig.line_total) === it.line_total &&
          orig.item_group === it.group &&
          (orig.qty ?? null) === (it.qty ?? null)
        ) {
          continue; // unchanged
        }
        const { error } = await supabase
          .from('transaction_items')
          .update({ name: it.name, qty: it.qty, line_total: it.line_total, item_group: it.group })
          .eq('id', it.id);
        if (error) throw error;
      }

      // Brand-new rows → insert.
      const toInsert = items
        .filter((it) => !it.id && it.name.trim())
        .map((it) => ({
          household_id: householdId,
          transaction_id: transactionId,
          name: it.name.trim(),
          qty: it.qty,
          line_total: it.line_total,
          item_group: it.group,
        }));
      if (toInsert.length > 0) {
        const { error } = await supabase.from('transaction_items').insert(toInsert);
        if (error) throw error;
      }

      await invalidateItemQueries();
      toast.success('Productos actualizados ✓');
      setEditing(false);
    } catch (e) {
      toast.error('No se pudo guardar. Intentá de nuevo.');
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  async function invalidateItemQueries() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['transaction-items', transactionId] }),
      qc.invalidateQueries({ queryKey: ['super-items'] }),
      // The /movimientos "🧾 Productos" chip keys off this set, so a purchase
      // that just got its first item should start showing the badge.
      qc.invalidateQueries({ queryKey: ['transaction-item-ids'] }),
    ]);
  }

  // Quick path for a no-detail purchase that's all one rubro (e.g. a verdulería
  // or panadería ticket): drop a single item for the whole amount in that group,
  // so it counts in the breakdown without itemising product by product.
  async function assignWholeToGroup(group: string) {
    if (!transactionId || total <= 0) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('transaction_items').insert({
        household_id: householdId,
        transaction_id: transactionId,
        name: merchant?.trim() || 'Compra',
        qty: 1,
        line_total: total,
        item_group: group,
      });
      if (error) throw error;
      await invalidateItemQueries();
      toast.success(`Asignado a ${group} ✓`);
    } catch (e) {
      toast.error('No se pudo asignar. Intentá de nuevo.');
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  const totalMismatch =
    items.length > 0 && Math.abs(itemsSum - total) > Math.max(50, total * 0.05);

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="bottom"
        className="rounded-t-3xl p-0 overflow-hidden"
        style={{ background: '#F1F5F3', maxHeight: '92dvh', transform: dragY ? `translateY(${dragY}px)` : undefined, transition: dragging ? 'none' : undefined }}
      >
        <div className="overflow-y-auto flex flex-col h-full">
          {/* drag handle — drag down to dismiss */}
          <div className="flex justify-center pt-3 pb-2 touch-none" {...handleProps}>
            <div className="w-10 h-1 rounded-full" style={{ background: '#E5EBE8' }} />
          </div>

          {/* Header: merchant + total */}
          <div className="px-5 pb-3">
            <p className="text-lg font-black truncate" style={{ color: '#18211D' }}>
              🧾 {merchant || 'Compra'}
            </p>
            <p className="text-xs" style={{ color: '#5B6660' }}>
              {new Date(occurredOn + 'T00:00:00').toLocaleDateString('es-AR', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </p>
            <p className="text-3xl font-black mt-1.5 tabular-nums" style={{ color: '#FF6F61' }}>
              {fmt(total)}
            </p>
          </div>

          <div className="px-4 pb-6 flex flex-col gap-4" style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}>
            {isLoading ? (
              <div className="rounded-3xl p-8 text-center" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
                <p className="text-3xl mb-2 animate-pulse">🧾</p>
                <p className="text-sm" style={{ color: '#5B6660' }}>Cargando productos…</p>
              </div>
            ) : items.length === 0 && !editing ? (
              <div className="rounded-3xl p-6" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
                <div className="text-center">
                  <p className="text-3xl mb-2">📭</p>
                  <p className="font-bold mb-1" style={{ color: '#18211D' }}>Sin detalle de productos</p>
                  <p className="text-sm" style={{ color: '#5B6660' }}>
                    Este gasto no tiene ítems cargados. Asignalo entero a un rubro, o cargá los productos uno por uno.
                  </p>
                </div>

                {/* Quick: whole purchase as one rubro */}
                <p className="text-[11px] font-bold uppercase tracking-wide mt-5 mb-2" style={{ color: '#8C968F' }}>
                  Asignar toda la compra ({fmt(total)}) a un rubro
                </p>
                <div className="flex flex-wrap gap-2">
                  {ITEM_GROUPS.map((g) => {
                    const meta = groupMeta(g);
                    return (
                      <button
                        key={g}
                        disabled={saving || total <= 0}
                        onClick={() => assignWholeToGroup(g)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-xs font-semibold border disabled:opacity-50"
                        style={{ borderColor: '#E5EBE8', color: '#18211D', background: '#F1F5F3' }}
                      >
                        <span>{meta.icon}</span>
                        <span className="capitalize">{g}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-3 my-4">
                  <div className="flex-1 h-px" style={{ background: '#E5EBE8' }} />
                  <span className="text-[11px]" style={{ color: '#8C968F' }}>o</span>
                  <div className="flex-1 h-px" style={{ background: '#E5EBE8' }} />
                </div>

                <button
                  onClick={() => startEdit([{ key: tmpKey(), id: null, name: '', qty: 1, line_total: 0, group: 'otros' }])}
                  className="w-full py-2.5 rounded-2xl text-sm font-bold"
                  style={{ background: '#DDF0E8', color: '#1F8A68' }}
                >
                  ＋ Cargar productos uno por uno
                </button>
              </div>
            ) : (
              <>
                {/* Group breakdown — where the money went */}
                {groupTotals.length > 0 && (
                  <div className="rounded-3xl p-5" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
                    <p className="text-xs font-bold uppercase tracking-wide mb-4" style={{ color: '#5B6660' }}>
                      En qué se fue
                    </p>
                    <div className="flex flex-col gap-3.5">
                      {groupTotals.map(({ g, total: gt }) => {
                        const meta = groupMeta(g);
                        const pct = itemsSum > 0 ? Math.round((gt / itemsSum) * 100) : 0;
                        return (
                          <div key={g}>
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="text-sm">{meta.icon}</span>
                              <span className="text-sm capitalize flex-1 truncate" style={{ color: '#18211D' }}>{g}</span>
                              <span className="text-[11px] font-semibold tabular-nums" style={{ color: '#8C968F' }}>{pct}%</span>
                              <span className="text-sm font-bold tabular-nums" style={{ color: meta.color }}>{fmt(gt)}</span>
                            </div>
                            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#EAF0ED' }}>
                              <div className="h-full rounded-full" style={{ width: `${Math.max(pct, 3)}%`, background: meta.color }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {totalMismatch && (
                  <p className="text-[11px] -mt-1 px-1" style={{ color: '#B8860B' }}>
                    ⚠️ La suma de productos ({fmt(itemsSum)}) no coincide con el total del gasto ({fmt(total)}).
                  </p>
                )}

                {/* Items list */}
                <div className="rounded-3xl p-3" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
                  <div className="flex items-center justify-between mb-2 px-2">
                    <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#5B6660' }}>
                      Productos ({items.length})
                    </p>
                    {!editing && (
                      <button
                        onClick={() => startEdit(baseItems)}
                        className="text-xs font-bold px-3 py-1 rounded-full border"
                        style={{ borderColor: '#2FA37C', color: '#1F8A68' }}
                      >
                        ✏️ Editar
                      </button>
                    )}
                  </div>

                  <div className="flex flex-col">
                    {editing
                      ? items.map((it, i) => (
                          <div
                            key={it.key}
                            className="flex items-center gap-2 px-2 py-2"
                            style={{ borderTop: i > 0 ? '1px solid #E5EBE8' : 'none' }}
                          >
                            <input
                              value={it.name}
                              onChange={(e) => updateItem(it.key, { name: e.target.value })}
                              placeholder="Producto"
                              className="flex-1 min-w-0 text-sm outline-none bg-transparent"
                              style={{ color: '#18211D' }}
                            />
                            <select
                              value={it.group}
                              onChange={(e) => updateItem(it.key, { group: e.target.value })}
                              className="text-[11px] rounded-lg px-1.5 py-1 border bg-white outline-none"
                              style={{ borderColor: '#E5EBE8', color: '#5B6660' }}
                            >
                              {ITEM_GROUPS.map((g) => (
                                <option key={g} value={g}>{groupMeta(g).icon} {g}</option>
                              ))}
                            </select>
                            <MoneyInput
                              value={it.line_total}
                              onChange={(n) => updateItem(it.key, { line_total: n })}
                              className="w-20 text-sm font-bold text-right outline-none bg-transparent"
                              style={{ color: '#18211D' }}
                            />
                            <button onClick={() => removeItem(it.key)} className="text-xs px-1" style={{ color: '#FF6F61' }}>✕</button>
                          </div>
                        ))
                      : items.map((it, i) => {
                          const meta = groupMeta(it.group);
                          return (
                            <div
                              key={it.key}
                              className="flex items-center gap-3 px-2 py-2.5"
                              style={{ borderTop: i > 0 ? '1px solid #E5EBE8' : 'none' }}
                            >
                              <span className="text-base shrink-0">{meta.icon}</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm truncate" style={{ color: '#18211D' }}>
                                  {it.qty && it.qty > 1 ? `${it.qty}× ` : ''}{it.name || 'Sin nombre'}
                                </p>
                                <p className="text-[11px] capitalize" style={{ color: '#8C968F' }}>{it.group}</p>
                              </div>
                              <span className="text-sm font-bold tabular-nums shrink-0" style={{ color: '#18211D' }}>
                                {fmt(it.line_total)}
                              </span>
                            </div>
                          );
                        })}
                  </div>

                  {editing && (
                    <button
                      onClick={addItem}
                      className="w-full mt-2 py-2.5 rounded-2xl text-sm font-bold border border-dashed"
                      style={{ borderColor: '#2FA37C', color: '#1F8A68' }}
                    >
                      ＋ Agregar producto
                    </button>
                  )}
                </div>

                {/* Items subtotal */}
                <div className="flex items-center justify-between px-2">
                  <span className="text-xs font-bold uppercase tracking-wide" style={{ color: '#5B6660' }}>Suma de productos</span>
                  <span className="text-sm font-black tabular-nums" style={{ color: '#18211D' }}>{fmt(itemsSum)}</span>
                </div>

                {editing && (
                  <div className="flex flex-col gap-2">
                    <PrimaryButton onClick={handleSave} loading={saving} className="w-full py-3.5 text-sm">
                      {saving ? 'Guardando…' : 'Guardar cambios'}
                    </PrimaryButton>
                    <button
                      onClick={() => setEditing(false)}
                      className="w-full py-2.5 rounded-2xl text-sm font-bold"
                      style={{ color: '#5B6660' }}
                    >
                      Cancelar
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
