'use client';

import { useState, useEffect } from 'react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { NumberKeypad } from '@/components/NumberKeypad';
import { useFx } from '@/hooks/useFx';
import { createClient } from '@/lib/supabase';
import { formatARS, formatUSD, usdToArs } from '@/lib/format';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

interface Category {
  id: string;
  name: string;
  icon: string;
  kind: string;
}

interface Account {
  id: string;
  name: string;
  type: string;
}

interface AddTransactionSheetProps {
  open: boolean;
  onClose: () => void;
  householdId: string;
  profileId: string;
  partnerProfileId?: string;
  categories: Category[];
  accounts: Account[];
  editTx?: EditTx | null;
  initialType?: 'expense' | 'income';
}

interface EditTx {
  id: string;
  amount: number;
  type: string;
  category_id: string | null;
  account_id: string | null;
  scope: string;
  is_shared: boolean;
  merchant: string | null;
  occurred_on: string;
}

export function AddTransactionSheet({
  open,
  onClose,
  householdId,
  profileId,
  partnerProfileId,
  categories,
  accounts,
  editTx,
  initialType = 'expense',
}: AddTransactionSheetProps) {
  const { arsPerUsd, showUSD } = useFx();
  const supabase = createClient();
  const qc = useQueryClient();

  const [inputUSD, setInputUSD] = useState(false);
  const [raw, setRaw] = useState('');
  const [txType, setTxType] = useState<'expense' | 'income'>('expense');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [scope, setScope] = useState<'personal' | 'household'>('personal');
  const [isShared, setIsShared] = useState(false);
  const [merchant, setMerchant] = useState('');
  const [date, setDate] = useState(today());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (editTx) {
        setRaw(String(editTx.amount));
        setTxType(editTx.type as 'expense' | 'income');
        setCategoryId(editTx.category_id);
        setAccountId(editTx.account_id);
        setScope(editTx.scope as 'personal' | 'household');
        setIsShared(editTx.is_shared);
        setMerchant(editTx.merchant ?? '');
        setDate(editTx.occurred_on);
      } else {
        setRaw('');
        setTxType(initialType);
        setCategoryId(null);
        setAccountId(accounts[0]?.id ?? null);
        setScope('personal');
        setIsShared(false);
        setMerchant('');
        setDate(today());
      }
      setInputUSD(false);
    }
  }, [open, editTx, initialType]);

  function today() {
    return new Date().toISOString().split('T')[0];
  }

  function handleDigit(d: string) {
    setRaw((prev) => {
      const next = prev + d;
      if (next.length > 12) return prev;
      return next;
    });
  }

  function handleBackspace() {
    setRaw((prev) => prev.slice(0, -1));
  }

  const arsAmount = (() => {
    const n = parseInt(raw || '0', 10);
    return inputUSD ? usdToArs(n, arsPerUsd) : n;
  })();

  const displayAmount = inputUSD
    ? formatUSD(parseInt(raw || '0', 10))
    : formatARS(parseInt(raw || '0', 10));

  const secondaryAmount = inputUSD
    ? `≈ ${formatARS(arsAmount)}`
    : `≈ ${formatUSD(Math.round(arsAmount / arsPerUsd))}`;

  const visibleCategories = categories.filter((c) => c.kind === txType);

  async function handleSave() {
    if (arsAmount === 0) return;
    setSaving(true);
    try {
      const payload = {
        household_id: householdId,
        profile_id: profileId,
        type: txType,
        amount: arsAmount,
        currency: 'ARS',
        usd_rate_snapshot: arsPerUsd,
        category_id: categoryId,
        account_id: accountId,
        merchant: merchant || null,
        occurred_on: date,
        scope,
        is_shared: isShared,
        source: 'manual' as const,
      };

      if (editTx) {
        const { error } = await supabase
          .from('transactions')
          .update(payload)
          .eq('id', editTx.id);
        if (error) throw error;
      } else {
        const { data: tx, error } = await supabase
          .from('transactions')
          .insert(payload)
          .select('id')
          .single();
        if (error) throw error;

        if (isShared && partnerProfileId && tx) {
          await supabase.from('splits').insert({
            transaction_id: tx.id,
            payer_profile_id: profileId,
            ower_profile_id: partnerProfileId,
            amount: Math.round(arsAmount / 2),
          });
        }
      }

      await qc.invalidateQueries({ queryKey: ['transactions'] });
      await qc.invalidateQueries({ queryKey: ['summary'] });
      await qc.invalidateQueries({ queryKey: ['projection'] });
      await qc.invalidateQueries({ queryKey: ['couple-balance'] });
      await qc.invalidateQueries({ queryKey: ['couple-transactions'] });
      toast.success(editTx ? 'Movimiento actualizado ✓' : 'Guardado ✓');
      onClose();
    } catch (e) {
      toast.error('No se pudo guardar. Intentá de nuevo.');
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="bottom"
        className="rounded-t-3xl p-0 overflow-hidden"
        style={{ background: '#F9F5F0', maxHeight: '95dvh' }}
      >
        <div className="overflow-y-auto flex flex-col h-full">
          {/* drag handle */}
          <div className="flex justify-center pt-3 pb-2">
            <div className="w-10 h-1 rounded-full" style={{ background: '#ECE5DC' }} />
          </div>

          {/* Amount display */}
          <div className="text-center px-6 pb-2">
            <div className="flex items-center justify-center gap-3 mb-1">
              <button
                onClick={() => setInputUSD((v) => !v)}
                className="text-xs font-bold px-3 py-1 rounded-full border"
                style={{
                  borderColor: inputUSD ? '#FF7F6B' : '#7EC8A4',
                  color: inputUSD ? '#FF7F6B' : '#7EC8A4',
                }}
              >
                {inputUSD ? 'USD' : 'ARS'}
              </button>
            </div>
            <p
              className="text-5xl font-black tracking-tight"
              style={{ color: txType === 'expense' ? '#FF7F6B' : '#7EC8A4', fontVariantNumeric: 'tabular-nums' }}
            >
              {displayAmount}
            </p>
            <p className="text-sm mt-1" style={{ color: '#8A8276' }}>
              {secondaryAmount}
            </p>
          </div>

          {/* Income / Expense toggle */}
          <div className="flex mx-6 mb-3 rounded-2xl overflow-hidden" style={{ background: '#ECE5DC' }}>
            {(['expense', 'income'] as const).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTxType(t);
                  setCategoryId(null);
                }}
                className="flex-1 py-2.5 text-sm font-bold transition-colors"
                style={{
                  background: txType === t ? (t === 'expense' ? '#FF7F6B' : '#7EC8A4') : 'transparent',
                  color: txType === t ? '#FFFFFF' : '#8A8276',
                  borderRadius: '14px',
                }}
              >
                {t === 'expense' ? 'Gasto' : 'Ingreso'}
              </button>
            ))}
          </div>

          {/* Category chips */}
          <div className="px-4 mb-3">
            <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
              {visibleCategories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCategoryId(categoryId === c.id ? null : c.id)}
                  className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-2xl text-sm font-semibold border transition-colors"
                  style={{
                    background: categoryId === c.id ? '#E4F2EA' : '#FFFFFF',
                    borderColor: categoryId === c.id ? '#7EC8A4' : '#ECE5DC',
                    color: categoryId === c.id ? '#5BA886' : '#2D2D2D',
                  }}
                >
                  <span>{c.icon}</span>
                  <span>{c.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Keypad */}
          <NumberKeypad onDigit={handleDigit} onBackspace={handleBackspace} />

          {/* Options row */}
          <div className="flex gap-2 px-4 mt-3 flex-wrap">
            {/* Scope */}
            <button
              onClick={() => setScope(scope === 'personal' ? 'household' : 'personal')}
              className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold border"
              style={{
                background: scope === 'household' ? '#E4F2EA' : '#FFFFFF',
                borderColor: scope === 'household' ? '#7EC8A4' : '#ECE5DC',
                color: scope === 'household' ? '#5BA886' : '#8A8276',
              }}
            >
              {scope === 'household' ? '🏠 Hogar' : '👤 Personal'}
            </button>

            {/* Shared */}
            <button
              onClick={() => setIsShared((v) => !v)}
              className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold border"
              style={{
                background: isShared ? '#FFE7E2' : '#FFFFFF',
                borderColor: isShared ? '#FF7F6B' : '#ECE5DC',
                color: isShared ? '#FF7F6B' : '#8A8276',
              }}
            >
              {isShared ? '🤝 Compartido' : '🤝 Dividir'}
            </button>

            {/* Account */}
            {accounts.length > 0 && (
              <select
                value={accountId ?? ''}
                onChange={(e) => setAccountId(e.target.value || null)}
                className="px-3 py-2 rounded-xl text-xs font-bold border bg-white"
                style={{ borderColor: '#ECE5DC', color: '#2D2D2D' }}
              >
                <option value="">Sin cuenta</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}

            {/* Date */}
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="px-3 py-2 rounded-xl text-xs font-bold border bg-white"
              style={{ borderColor: '#ECE5DC', color: '#2D2D2D' }}
            />
          </div>

          {/* Merchant/description */}
          <div className="px-4 mt-3">
            <input
              type="text"
              placeholder="Descripción (opcional)"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              className="w-full px-4 py-3 rounded-2xl text-sm border bg-white outline-none"
              style={{ borderColor: '#ECE5DC', color: '#2D2D2D' }}
            />
          </div>

          {/* Save button */}
          <div className="px-4 pb-6 mt-4" style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}>
            <button
              onClick={handleSave}
              disabled={arsAmount === 0 || saving}
              className="w-full py-4 rounded-2xl text-lg font-black text-white disabled:opacity-40 transition-opacity"
              style={{ background: '#7EC8A4' }}
            >
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
