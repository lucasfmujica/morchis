'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { BottomNav } from '@/components/BottomNav';
import { AddTransactionSheet } from '@/components/AddTransactionSheet';
import { formatARS } from '@/lib/format';

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
  active: boolean;
}

interface Category {
  id: string;
  name: string;
  icon: string;
  kind: string;
}

function barColor(pct: number): string {
  if (pct >= 1) return '#FF7F6B';
  if (pct >= 0.8) return '#F5A623';
  return '#7EC8A4';
}

function BudgetBar({ spent, limit }: { spent: number; limit: number }) {
  const pct = limit > 0 ? Math.min(spent / limit, 1) : 0;
  const over = limit > 0 && spent > limit;
  const color = barColor(limit > 0 ? spent / limit : 0);

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
          {formatARS(spent)} gastado
        </span>
        <span className="text-xs" style={{ color: over ? '#FF7F6B' : '#8A8276' }}>
          {over ? `+${formatARS(spent - limit)} excedido` : `de ${formatARS(limit)}`}
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
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!categoryId || !amount) return;
    setSaving(true);
    const payload = {
      household_id: householdId,
      category_id: categoryId,
      scope,
      profile_id: scope === 'personal' ? profileId : null,
      amount: parseInt(amount.replace(/\D/g, ''), 10),
      period: 'monthly',
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
        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#8A8276' }}>Alcance</p>
        <div className="flex rounded-2xl overflow-hidden mb-4 p-1 gap-1" style={{ background: '#ECE5DC' }}>
          {(['personal', 'household'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className="flex-1 py-1.5 text-xs font-bold rounded-xl transition-colors"
              style={{
                background: scope === s ? '#FFFFFF' : 'transparent',
                color: scope === s ? '#2D2D2D' : '#8A8276',
              }}
            >
              {s === 'personal' ? 'Personal' : 'Nuestro'}
            </button>
          ))}
        </div>

        {/* Category */}
        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#8A8276' }}>Categoría</p>
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

        {/* Amount */}
        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#8A8276' }}>Límite mensual (ARS)</p>
        <input
          type="number"
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Ej: 50000"
          className="w-full rounded-2xl px-4 py-3 text-lg font-bold mb-5 outline-none border-2 transition-colors"
          style={{
            background: '#F9F5F0',
            color: '#2D2D2D',
            borderColor: amount ? '#7EC8A4' : '#ECE5DC',
          }}
        />

        <button
          onClick={save}
          disabled={saving || !categoryId || !amount}
          className="w-full py-4 rounded-2xl font-bold text-white"
          style={{ background: saving || !categoryId || !amount ? '#ECE5DC' : '#7EC8A4' }}
        >
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </div>
  );
}

export default function PresupuestosClient({ profile }: { profile: Profile }) {
  const supabase = createClient();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'personal' | 'household'>('personal');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Budget | null>(null);
  const [budgetSheetOpen, setBudgetSheetOpen] = useState(false);

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['categories', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('categories')
        .select('id, name, icon, kind')
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
        .select('id, name, type')
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

  // Load this month's expenses grouped by category
  const { data: spentByCategory = {} } = useQuery<Record<string, number>>({
    queryKey: ['spent-by-category', profile.household_id, monthStart],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('category_id, amount, scope, profile_id')
        .eq('household_id', profile.household_id)
        .eq('type', 'expense')
        .gte('occurred_on', monthStart);

      const map: Record<string, number> = {};
      for (const t of data ?? []) {
        if (!t.category_id) continue;
        map[t.category_id] = (map[t.category_id] ?? 0) + t.amount;
      }
      return map;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from('budgets').update({ active: false }).eq('id', id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets'] }),
  });

  const filteredBudgets = budgets.filter((b) => b.scope === tab);

  const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));

  function openNew() {
    setEditing(null);
    setBudgetSheetOpen(true);
  }

  function openEdit(b: Budget) {
    setEditing(b);
    setBudgetSheetOpen(true);
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
              color: tab === t ? '#2D2D2D' : '#8A8276',
            }}
          >
            {t === 'personal' ? 'Personal' : 'Nuestro'}
          </button>
        ))}
      </div>

      {/* Budget cards */}
      <div className="px-4 flex flex-col gap-3">
        {filteredBudgets.length === 0 ? (
          <div className="rounded-3xl p-6 text-center" style={{ background: '#FFFFFF' }}>
            <p className="text-3xl mb-2">📊</p>
            <p className="font-semibold" style={{ color: '#2D2D2D' }}>Sin presupuestos todavía</p>
            <p className="text-sm mt-1" style={{ color: '#8A8276' }}>
              Tocá + para crear uno y ver cuánto gastás.
            </p>
            <button
              onClick={openNew}
              className="mt-4 px-5 py-2.5 rounded-2xl text-sm font-bold text-white"
              style={{ background: '#7EC8A4' }}
            >
              Crear presupuesto
            </button>
          </div>
        ) : (
          filteredBudgets.map((b) => {
            const cat = catMap[b.category_id];
            const spent = spentByCategory[b.category_id] ?? 0;
            const over = spent > b.amount;
            return (
              <div key={b.id} className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{cat?.icon ?? '📦'}</span>
                    <div>
                      <p className="font-bold text-sm" style={{ color: '#2D2D2D' }}>{cat?.name ?? '—'}</p>
                      {over && (
                        <span
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{ background: '#FFE7E2', color: '#FF7F6B' }}
                        >
                          Excedido
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => openEdit(b)}
                      className="text-xs px-3 py-1.5 rounded-xl font-semibold"
                      style={{ background: '#F9F5F0', color: '#8A8276' }}
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => deleteMutation.mutate(b.id)}
                      className="text-xs px-3 py-1.5 rounded-xl font-semibold"
                      style={{ background: '#FFE7E2', color: '#FF7F6B' }}
                    >
                      Borrar
                    </button>
                  </div>
                </div>
                <BudgetBar spent={spent} limit={b.amount} />
              </div>
            );
          })
        )}
      </div>

      <BottomNav onFab={() => setSheetOpen(true)} />

      <AddTransactionSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        householdId={profile.household_id}
        profileId={profile.id}
        categories={categories}
        accounts={accounts}
      />

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
