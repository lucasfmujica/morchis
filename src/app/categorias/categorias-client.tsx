'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { BottomNav } from '@/components/BottomNav';
import { AddTransactionSheet } from '@/components/AddTransactionSheet';
import { toast } from 'sonner';
import { formatARS } from '@/lib/format';
import { monthKey } from '@/lib/date';
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

export default function CategoriasClient({ profile }: { profile: Profile }) {
  const supabase = createClient();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('🏷️');
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [saving, setSaving] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fabType, setFabType] = useState<'expense' | 'income'>('expense');

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

  // This month's totals per category (expense + income).
  const { data: monthByCategory = {} } = useQuery<Record<string, number>>({
    queryKey: ['spent-by-category', profile.household_id, monthStart],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('category_id, amount')
        .eq('household_id', profile.household_id)
        .gte('occurred_on', monthStart);
      const map: Record<string, number> = {};
      for (const t of data ?? []) {
        if (!t.category_id) continue;
        map[t.category_id] = (map[t.category_id] ?? 0) + t.amount;
      }
      return map;
    },
  });

  // Active budget amount per category (summed across scopes).
  const { data: budgetByCategory = {} } = useQuery<Record<string, number>>({
    queryKey: ['budgets', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('budgets')
        .select('category_id, amount')
        .eq('household_id', profile.household_id)
        .eq('active', true);
      const map: Record<string, number> = {};
      for (const b of data ?? []) {
        map[b.category_id] = (map[b.category_id] ?? 0) + b.amount;
      }
      return map;
    },
  });

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
