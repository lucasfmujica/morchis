'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { BottomNav } from '@/components/BottomNav';
import { AddTransactionSheet } from '@/components/AddTransactionSheet';
import { toast } from 'sonner';

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

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('categories')
        .select('id, name, icon, kind, is_default')
        .eq('household_id', profile.household_id)
        .order('kind')
        .order('name');
      return data ?? [];
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
                      color: kind === k ? '#FFFFFF' : '#8A8276',
                      borderRadius: '14px',
                    }}
                  >
                    {k === 'expense' ? 'Gasto' : 'Ingreso'}
                  </button>
                ))}
              </div>
            )}
            <div>
              <p className="text-xs font-bold mb-2" style={{ color: '#8A8276' }}>Ícono</p>
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
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 py-3 rounded-2xl border text-sm font-bold"
                style={{ borderColor: '#ECE5DC', color: '#8A8276' }}
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-3 rounded-2xl text-sm font-bold text-white disabled:opacity-40"
                style={{ background: '#7EC8A4' }}
              >
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {[
        { label: 'Gastos', cats: expenseCategories },
        { label: 'Ingresos', cats: incomeCategories },
      ].map(({ label, cats }) => (
        <div key={label} className="px-4 mb-4">
          <p className="text-xs font-black mb-2" style={{ color: '#8A8276' }}>{label.toUpperCase()}</p>
          <div className="rounded-3xl overflow-hidden" style={{ background: '#FFFFFF' }}>
            {cats.map((c, i) => (
              <button
                key={c.id}
                onClick={() => openEdit(c)}
                className="w-full flex items-center gap-3 px-4 py-3.5"
                style={{ borderTop: i > 0 ? '1px solid #ECE5DC' : 'none' }}
              >
                <span className="text-2xl">{c.icon}</span>
                <p className="flex-1 text-sm font-semibold text-left" style={{ color: '#2D2D2D' }}>{c.name}</p>
                <span className="text-xs" style={{ color: '#8A8276' }}>Editar →</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      <BottomNav onFab={() => setSheetOpen(true)} />
      <AddTransactionSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        householdId={profile.household_id}
        profileId={profile.id}
        categories={categories}
        accounts={[]}
      />
    </div>
  );
}
