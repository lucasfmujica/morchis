'use client';

import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { useFx } from '@/hooks/useFx';
import { BottomNav } from '@/components/BottomNav';
import { AddTransactionSheet } from '@/components/AddTransactionSheet';
import { toast } from 'sonner';
import { formatARS } from '@/lib/format';
import { monthKey } from '@/lib/date';
import { BUDGET_EXPENSE_SELECT, myShareArs, toArs, type BudgetExpenseRow } from '@/lib/budgets';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SecondaryButton } from '@/components/SecondaryButton';
import Link from 'next/link';

const ICONS = ['🛒', '🍕', '🚇', '💊', '🎭', '📚', '✈️', '🏠', '💼', '💵', '📱', '💻', '👗', '🏷️', '💰', '🎯', '🎮', '🐾', '🌿', '⚽'];

interface Profile {
  id: string;
  household_id: string;
  nickname: string | null;
  display_name: string | null;
}

export default function CategoriasClient({
  profile,
  partnerProfileId,
  partnerName,
}: {
  profile: Profile;
  partnerProfileId?: string;
  partnerName?: string;
}) {
  const supabase = createClient();
  const qc = useQueryClient();
  const { arsPerUsd } = useFx();
  // Whose spending the per-category totals reflect. Defaults to "Mío" so the
  // screen is personal/individual instead of mixing in your partner's expenses.
  const [scope, setScope] = useState<'me' | 'all' | 'partner'>('me');
  const scopeProfileId = scope === 'me' ? profile.id : scope === 'partner' ? partnerProfileId : undefined;
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('🏷️');
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [saving, setSaving] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fabType, setFabType] = useState<'expense' | 'income' | 'transfer'>('expense');

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('categories')
        .select('id, name, icon, kind, color, is_default')
        .eq('household_id', profile.household_id)
        .order('kind')
        .order('name');
      return data ?? [];
    },
  });

  const monthStart = monthKey() + '-01';
  // Last day of the current month, so future-dated rows (later installments)
  // don't inflate this month's per-category totals.
  const monthEndDate = new Date();
  const monthEnd = `${monthEndDate.getFullYear()}-${String(monthEndDate.getMonth() + 1).padStart(2, '0')}-${String(new Date(monthEndDate.getFullYear(), monthEndDate.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;

  // This month's rows per category (expense + income), kept raw so the totals
  // can be re-sliced by scope (Mío / Nuestro / Pareja) without refetching.
  // Own key (not the Home's 'spent-by-category', which is expenses-only) so the
  // two don't overwrite each other's cache.
  const { data: monthRows = [] } = useQuery<BudgetExpenseRow[]>({
    queryKey: ['category-month-totals', profile.household_id, monthStart],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select(BUDGET_EXPENSE_SELECT)
        .eq('household_id', profile.household_id)
        .gte('occurred_on', monthStart)
        .lte('occurred_on', monthEnd);
      return data ?? [];
    },
  });

  // Per-category totals for the active scope. "Nuestro" counts every movement
  // once, in full; "Mío"/"Pareja" count that person's share of shared expenses
  // (whoever paid) plus their own solo movements — same attribution as the
  // budgets math, so a shared expense never lands 100% on whoever fronted it.
  const monthByCategory = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const t of monthRows) {
      if (!t.category_id) continue;
      const amt = !scopeProfileId
        ? toArs(t.amount, t.currency, arsPerUsd)
        : t.is_shared
          ? myShareArs(t, scopeProfileId, arsPerUsd)
          : t.profile_id === scopeProfileId
            ? toArs(t.amount, t.currency, arsPerUsd)
            : 0;
      if (amt <= 0) continue;
      map[t.category_id] = (map[t.category_id] ?? 0) + amt;
    }
    return map;
  }, [monthRows, scopeProfileId, arsPerUsd]);

  // Active budgets, kept raw so the per-category limit can follow the active
  // tab without refetching (and so 'budgets' invalidations refresh it too).
  const { data: budgetRows = [] } = useQuery<
    { category_id: string; amount: number; currency: string | null; scope: string; profile_id: string | null }[]
  >({
    queryKey: ['budgets', profile.household_id, 'rows'],
    queryFn: async () => {
      const { data } = await supabase
        .from('budgets')
        .select('category_id, amount, currency, scope, profile_id')
        .eq('household_id', profile.household_id)
        .eq('active', true);
      return data ?? [];
    },
  });

  // Budget amount per category for the active tab only: "Nuestro" compares
  // against household budgets, "Mío"/"Pareja" against that person's personal
  // ones — summing every scope inflated the limit and broke the % / "Excedido".
  // Normalized to ARS so a USD budget is compared against the ARS-normalized
  // spend above instead of being read as pesos.
  const budgetByCategory = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const b of budgetRows) {
      const matchesTab = scopeProfileId
        ? b.scope === 'personal' && b.profile_id === scopeProfileId
        : b.scope === 'household';
      if (!matchesTab) continue;
      map[b.category_id] = (map[b.category_id] ?? 0) + toArs(b.amount, b.currency, arsPerUsd);
    }
    return map;
  }, [budgetRows, scopeProfileId, arsPerUsd]);

  function openNew() {
    setEditId(null);
    setName('');
    setIcon('🏷️');
    setKind('expense');
    setShowForm(true);
  }

  function openEdit(c: (typeof categories)[0]) {
    setEditId(c.id);
    setName(c.name);
    setIcon(c.icon);
    setKind(c.kind as 'expense' | 'income');
    setShowForm(true);
  }

  async function handleSave() {
    if (!name.trim()) { toast.error('Ingresá un nombre.'); return; }
    setSaving(true);
    try {
      if (editId) {
        const { error } = await supabase.from('categories').update({ name: name.trim(), icon }).eq('id', editId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('categories').insert({
          household_id: profile.household_id,
          name: name.trim(),
          icon,
          kind,
          is_default: false,
        });
        if (error) throw error;
      }
      await qc.invalidateQueries({ queryKey: ['categories'] });
      toast.success(editId ? 'Categoría actualizada ✓' : 'Categoría creada ✓');
      setShowForm(false);
    } catch (e) {
      toast.error('No se pudo guardar.');
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  const expenseCategories = categories.filter((c) => c.kind === 'expense');
  const incomeCategories = categories.filter((c) => c.kind === 'income');

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F9F5F0' }}>
      <header className="px-5 pt-14 pb-4 flex items-center justify-between">
        <h1 className="text-2xl font-black" style={{ color: '#2D2D2D' }}>Categorías</h1>
        <button
          onClick={openNew}
          className="text-sm font-bold px-4 py-2 rounded-2xl text-white"
          style={{ background: '#7EC8A4' }}
        >
          + Nueva
        </button>
      </header>

      {/* Scope toggle — keep the per-category totals personal by default */}
      <div className="mx-4 mb-3 flex rounded-2xl overflow-hidden p-1 gap-1" style={{ background: '#ECE5DC' }}>
        {([
          { key: 'me' as const, label: 'Mío' },
          { key: 'all' as const, label: 'Nuestro' },
          ...(partnerProfileId ? [{ key: 'partner' as const, label: partnerName || 'Pareja' }] : []),
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setScope(tab.key)}
            className="flex-1 py-1.5 text-xs font-bold rounded-xl transition-colors"
            style={{
              background: scope === tab.key ? '#FFFFFF' : 'transparent',
              color: scope === tab.key ? '#2D2D2D' : '#6B6459',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {showForm && (
        <div className="mx-4 mb-4 rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
          <p className="text-base font-black mb-4" style={{ color: '#2D2D2D' }}>
            {editId ? 'Editar categoría' : 'Nueva categoría'}
          </p>
          <div className="flex flex-col gap-3">
            <input
              type="text"
              placeholder="Nombre"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="px-4 py-3 rounded-2xl border text-sm outline-none"
              style={{ borderColor: '#ECE5DC' }}
            />
            {!editId && (
              <div className="flex rounded-2xl overflow-hidden" style={{ background: '#ECE5DC' }}>
                {(['expense', 'income'] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setKind(k)}
                    className="flex-1 py-2.5 text-sm font-bold"
                    style={{
                      background: kind === k ? (k === 'expense' ? '#FF7F6B' : '#7EC8A4') : 'transparent',
                      color: kind === k ? '#FFFFFF' : '#6B6459',
                      borderRadius: '14px',
                    }}
                  >
                    {k === 'expense' ? 'Gasto' : 'Ingreso'}
                  </button>
                ))}
              </div>
            )}
            <div>
              <p className="text-xs font-bold mb-2" style={{ color: '#6B6459' }}>Ícono</p>
              <div className="flex flex-wrap gap-2">
                {ICONS.map((ic) => (
                  <button
                    key={ic}
                    onClick={() => setIcon(ic)}
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
                    style={{
                      background: icon === ic ? '#E4F2EA' : '#F9F5F0',
                      border: icon === ic ? '2px solid #7EC8A4' : '2px solid transparent',
                    }}
                  >
                    {ic}
                  </button>
                ))}
              </div>
            </div>
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

      {[
        { label: 'Gastos', cats: expenseCategories },
        { label: 'Ingresos', cats: incomeCategories },
      ].map(({ label, cats }) => (
        <div key={label} className="px-4 mb-4">
          <p className="text-xs font-black mb-2" style={{ color: '#6B6459' }}>{label.toUpperCase()} · ESTE MES</p>
          <div className="rounded-3xl overflow-hidden" style={{ background: '#FFFFFF' }}>
            {cats.map((c, i) => {
              const spent = monthByCategory[c.id] ?? 0;
              const budget = budgetByCategory[c.id] ?? 0;
              const hasBudget = c.kind === 'expense' && budget > 0;
              const pct = hasBudget ? spent / budget : 0;
              const barCol = pct >= 1 ? '#FF7F6B' : pct >= 0.8 ? '#F5A623' : '#7EC8A4';
              return (
                <div
                  key={c.id}
                  className="flex items-stretch"
                  style={{ borderTop: i > 0 ? '1px solid #ECE5DC' : 'none' }}
                >
                  <Link href={`/categorias/${c.id}`} className="flex-1 min-w-0 px-4 py-3.5 text-left">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{c.icon}</span>
                      <p className="flex-1 text-sm font-semibold truncate" style={{ color: '#2D2D2D' }}>{c.name}</p>
                      <div className="text-right">
                        <p
                          className="text-sm font-black"
                          style={{ color: spent === 0 ? '#6B6459' : c.kind === 'income' ? '#5BA886' : '#2D2D2D' }}
                        >
                          {spent > 0 ? formatARS(spent) : '—'}
                        </p>
                        {hasBudget && (
                          <p className="text-[10px]" style={{ color: '#6B6459' }}>de {formatARS(budget)}</p>
                        )}
                      </div>
                    </div>
                    {hasBudget && (
                      <div className="mt-2 ml-9">
                        <div className="h-2 rounded-full overflow-hidden" style={{ background: '#ECE5DC' }}>
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(pct * 100, 100)}%`, background: barCol }}
                          />
                        </div>
                        <div className="flex justify-between mt-0.5">
                          <span className="text-[10px] font-bold" style={{ color: barCol }}>
                            {Math.round(pct * 100)}%
                          </span>
                          {pct >= 1 && (
                            <span className="text-[10px] font-bold" style={{ color: '#FF7F6B' }}>Excedido</span>
                          )}
                        </div>
                      </div>
                    )}
                  </Link>
                  <button
                    onClick={() => openEdit(c)}
                    className="px-4 flex items-center text-base"
                    style={{ color: '#6B6459' }}
                    aria-label={`Editar ${c.name}`}
                  >
                    ✏️
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <BottomNav onFab={(type) => { setFabType(type); setSheetOpen(true); }} />
      <AddTransactionSheet
        open={sheetOpen}
        initialType={fabType}
        onClose={() => setSheetOpen(false)}
        householdId={profile.household_id}
        profileId={profile.id}
        categories={categories}
        accounts={[]}
      />
    </div>
  );
}
