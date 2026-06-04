'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { NumberKeypad } from '@/components/NumberKeypad';
import { useFx } from '@/hooks/useFx';
import { createClient } from '@/lib/supabase';
import { formatARS, formatUSD, usdToArs } from '@/lib/format';
import { PrimaryButton } from '@/components/PrimaryButton';
import { todayISO } from '@/lib/date';
import { triggerBudgetAlerts } from '@/lib/notifyBudgets';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';

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
  // Optional so pages that don't fetch ownership still compile; when it's
  // missing we don't narrow the picker (see visibleAccounts below).
  owner_profile_id?: string | null;
}

interface AddTransactionSheetProps {
  open: boolean;
  onClose: () => void;
  householdId: string;
  profileId: string;
  partnerProfileId?: string;
  partnerName?: string;
  categories: Category[];
  accounts: Account[];
  editTx?: EditTx | null;
  initialType?: 'expense' | 'income';
}

interface EditTx {
  id: string;
  amount: number;
  type: string;
  currency: string;
  category_id: string | null;
  account_id: string | null;
  scope: string;
  is_shared: boolean;
  merchant: string | null;
  occurred_on: string;
  // Whose movement it is. Optional because not every edit caller selects it;
  // when missing we treat it as mine.
  profile_id?: string | null;
}

export function AddTransactionSheet({
  open,
  onClose,
  householdId,
  profileId,
  partnerProfileId,
  partnerName,
  categories,
  accounts,
  editTx,
  initialType = 'expense',
}: AddTransactionSheetProps) {
  const { arsPerUsd, showUSD } = useFx();
  const supabase = createClient();
  const qc = useQueryClient();
  const router = useRouter();

  // Resolve the partner from the household when the opening page didn't pass it,
  // so "Compartido" always creates a split (the silent-no-split bug otherwise).
  const { data: resolvedPartner } = useQuery({
    queryKey: ['sheet-partner', householdId, profileId],
    enabled: !!householdId,
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, nickname, display_name')
        .eq('household_id', householdId)
        .neq('id', profileId)
        .limit(1)
        .maybeSingle();
      return data;
    },
  });
  const effectivePartnerId = partnerProfileId ?? resolvedPartner?.id ?? null;
  const effectivePartnerName =
    partnerName ?? resolvedPartner?.nickname ?? resolvedPartner?.display_name ?? 'Tu pareja';

  // Decide who a movement belongs to when (re)opening the sheet. Household
  // beats everything; otherwise a profile_id that isn't mine means it's the
  // partner's; default to mine.
  function ownerOf(tx: { scope: string; profile_id?: string | null }): 'me' | 'partner' | 'household' {
    if (tx.scope === 'household') return 'household';
    if (tx.profile_id && tx.profile_id !== profileId && tx.profile_id === effectivePartnerId) return 'partner';
    return 'me';
  }

  const [inputUSD, setInputUSD] = useState(false);
  const [raw, setRaw] = useState('');
  const [txType, setTxType] = useState<'expense' | 'income'>('expense');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  // Who the movement belongs to: mine, my partner's (loaded on their behalf,
  // with their accounts), or the shared household.
  const [owner, setOwner] = useState<'me' | 'partner' | 'household'>('me');
  const [isShared, setIsShared] = useState(false);
  // Who actually fronted the money. Only meaningful for a "Hogar" movement:
  // a "Mío"/partner movement is paid by that same person. Decoupling this from
  // the owner is what lets a household expense be paid by either person (and
  // stay visible to both) instead of always assuming the creator paid.
  const [paidBy, setPaidBy] = useState<'me' | 'partner'>('me');
  // Percentage of a shared expense that *I* cover. Partner owes the rest.
  const [myShare, setMyShare] = useState(50);
  const [merchant, setMerchant] = useState('');
  const [date, setDate] = useState(todayISO());
  const [installments, setInstallments] = useState(1);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (editTx) {
        setRaw(String(editTx.amount));
        setTxType(editTx.type as 'expense' | 'income');
        setCategoryId(editTx.category_id);
        setAccountId(editTx.account_id);
        setOwner(ownerOf(editTx));
        setIsShared(editTx.is_shared);
        // profile_id is the payer, so a movement whose profile isn't mine was
        // paid by my partner.
        setPaidBy(editTx.profile_id && editTx.profile_id !== profileId ? 'partner' : 'me');
        setMerchant(editTx.merchant ?? '');
        setDate(editTx.occurred_on);
        setInputUSD(editTx.currency === 'USD');
        setMyShare(50); // refined from the existing split below, once it loads
      } else {
        setRaw('');
        setTxType(initialType);
        setCategoryId(null);
        // New movement starts as "Mío", so default to the first account I own.
        setAccountId(accounts.find((a) => a.owner_profile_id === profileId)?.id ?? accounts[0]?.id ?? null);
        setOwner('me');
        setIsShared(false);
        setPaidBy('me');
        setMerchant('');
        setDate(todayISO());
        setInputUSD(false);
        setMyShare(50);
      }
      setInstallments(1);
    }
  }, [open, editTx, initialType]);

  // When editing an already-shared expense, load the saved split so the
  // percentage control reflects how it was actually divided.
  useEffect(() => {
    if (!open || !editTx?.is_shared) return;
    let cancelled = false;
    (async () => {
      const { data: split } = await supabase
        .from('splits')
        .select('amount')
        .eq('transaction_id', editTx.id)
        .maybeSingle();
      if (cancelled || !split || editTx.amount <= 0) return;
      const arsTotal =
        editTx.currency === 'USD' ? usdToArs(editTx.amount, arsPerUsd) : editTx.amount;
      if (arsTotal <= 0) return;
      // split.amount is what the OWER owes the payer. If I paid, the ower is my
      // partner so my share is the remainder; if my partner paid (the movement
      // is theirs), the ower is me so the split is directly my share.
      const owerPct = Math.round((split.amount / arsTotal) * 100);
      // profile_id is the payer; if it's mine I paid, so my share is the
      // remainder, otherwise the split amount is directly my (the ower's) share.
      const iPaid = editTx.profile_id ? editTx.profile_id === profileId : ownerOf(editTx) !== 'partner';
      setMyShare(Math.min(100, Math.max(0, iPaid ? 100 - owerPct : owerPct)));
    })();
    return () => {
      cancelled = true;
    };
  }, [open, editTx, arsPerUsd, supabase]);

  function addMonthsISO(iso: string, k: number) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1 + k, d);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
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

  // The transaction is stored in its native currency (USD stays USD instead of
  // being force-converted to ARS), so USD accounts/income keep correct balances.
  const nativeAmount = parseInt(raw || '0', 10);
  const txCurrency: 'ARS' | 'USD' = inputUSD ? 'USD' : 'ARS';
  // ARS equivalent, used only for the couple-split math and the ≈ preview.
  const arsAmount = inputUSD ? usdToArs(nativeAmount, arsPerUsd) : nativeAmount;

  const displayAmount = inputUSD
    ? formatUSD(parseInt(raw || '0', 10))
    : formatARS(parseInt(raw || '0', 10));

  const secondaryAmount = inputUSD
    ? `≈ ${formatARS(arsAmount)}`
    : `≈ ${formatUSD(Math.round(arsAmount / arsPerUsd))}`;

  const visibleCategories = categories.filter((c) => c.kind === txType);

  // Derived from the owner control: a household movement is shared scope; mine
  // and the partner's are both "personal" scope but differ in whose profile
  // they belong to.
  const scope: 'personal' | 'household' = owner === 'household' ? 'household' : 'personal';

  // Who fronted the money. A "Mío" movement is paid by me; the partner's by
  // them; a "Hogar" movement can be paid by either (the `paidBy` control). This
  // is the single source of truth for the payer — used for the split direction,
  // the transaction's profile_id and the account picker.
  const iAmPayer = owner === 'household' ? paidBy === 'me' : owner !== 'partner';
  const payerId = iAmPayer ? profileId : effectivePartnerId;
  const owerId = iAmPayer ? effectivePartnerId : profileId;

  // The transaction belongs to whoever paid it (their account took the hit).
  // Visibility for a shared bill comes from `scope === 'household'`, not the
  // profile, so a household expense stays visible to both no matter who paid.
  const txProfileId = payerId ?? profileId;

  // Account picker scope: list the payer's own accounts (plus any with no known
  // owner). A "Mío" movement → my accounts; the partner's → theirs; "Hogar" →
  // whoever paid, so you pick the card that was actually used.
  const visibleAccounts = accounts.filter(
    (a) => a.owner_profile_id == null || a.owner_profile_id === txProfileId,
  );

  // If the selected account is no longer offered (e.g. switched back to Personal
  // while a partner's account was picked), fall back to the first available one
  // so we never silently save a hidden selection. Derived at render — no effect.
  const effectiveAccountId =
    accountId && visibleAccounts.some((a) => a.id === accountId)
      ? accountId
      : (visibleAccounts[0]?.id ?? null);

  // Cuotas: only for new expenses. The entered amount is the TOTAL purchase,
  // split into N monthly charges.
  const canInstallments = txType === 'expense' && !editTx;
  const useInstallments = canInstallments && installments > 1;
  const perInstallment = installments > 0 ? Math.floor(nativeAmount / installments) : nativeAmount;

  // Shared split: I cover `myShare`% of the bill; the other person owes the
  // rest. We can only divide when we actually know who the partner is.
  const canSplit = isShared && !!effectivePartnerId;
  // The ower's percentage of the bill. myShare is always *my* percentage, so
  // the ower's cut is the complement when I paid, or my own cut when I owe.
  const owerPct = iAmPayer ? 100 - myShare : myShare;
  // How much the ower owes the payer, in ARS, for a given ARS amount.
  const owedArs = (ars: number) => Math.round((ars * owerPct) / 100);
  // Live preview amounts in the entered currency.
  const partnerShareNative = Math.round((nativeAmount * (100 - myShare)) / 100);
  const myShareNative = nativeAmount - partnerShareNative;
  const fmtNative = (n: number) => (inputUSD ? formatUSD(n) : formatARS(n));

  async function handleSave() {
    if (nativeAmount === 0) return;
    setSaving(true);
    try {
      const payload = {
        household_id: householdId,
        profile_id: txProfileId,
        type: txType,
        amount: nativeAmount,
        currency: txCurrency,
        usd_rate_snapshot: arsPerUsd,
        category_id: categoryId,
        account_id: effectiveAccountId,
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

        // Re-sync the split to match the current shared/percentage choice.
        // (Editing previously never touched splits, so toggling "Compartido"
        // on an existing movement silently did nothing.)
        await supabase.from('splits').delete().eq('transaction_id', editTx.id);
        const owed = owedArs(arsAmount);
        if (canSplit && owed > 0) {
          await supabase.from('splits').insert({
            transaction_id: editTx.id,
            payer_profile_id: payerId!,
            ower_profile_id: owerId!,
            amount: owed,
          });
        }
      } else if (useInstallments) {
        // Split the total into N monthly charges (one transaction per cuota).
        const groupId = crypto.randomUUID();
        const base = Math.floor(nativeAmount / installments);
        const rows = Array.from({ length: installments }, (_, k) => ({
          ...payload,
          // last cuota absorbs the rounding remainder
          amount: k === installments - 1 ? nativeAmount - base * (installments - 1) : base,
          occurred_on: addMonthsISO(date, k),
          installment_total: installments,
          installment_number: k + 1,
          installment_group_id: groupId,
        }));

        const { data: txs, error } = await supabase
          .from('transactions')
          .insert(rows)
          .select('id, amount');
        if (error) throw error;

        if (canSplit && txs) {
          const splitRows = txs
            .map((t) => ({
              transaction_id: t.id,
              payer_profile_id: payerId!,
              ower_profile_id: owerId!,
              // splits are tracked in ARS for the couple balance
              amount: owedArs(txCurrency === 'USD' ? usdToArs(t.amount, arsPerUsd) : t.amount),
            }))
            .filter((r) => r.amount > 0);
          if (splitRows.length > 0) await supabase.from('splits').insert(splitRows);
        }
      } else {
        const { data: tx, error } = await supabase
          .from('transactions')
          .insert(payload)
          .select('id')
          .single();
        if (error) throw error;

        const owed = owedArs(arsAmount);
        if (canSplit && tx && owed > 0) {
          await supabase.from('splits').insert({
            transaction_id: tx.id,
            payer_profile_id: payerId!,
            ower_profile_id: owerId!,
            amount: owed,
          });
        }
      }

      await qc.invalidateQueries({ queryKey: ['transactions'] });
      await qc.invalidateQueries({ queryKey: ['account-tx'] });
      await qc.invalidateQueries({ queryKey: ['spent-by-category'] });
      await qc.invalidateQueries({ queryKey: ['category-month-totals'] });
      await qc.invalidateQueries({ queryKey: ['budget-expense-rows'] });
      await qc.invalidateQueries({ queryKey: ['summary'] });
      await qc.invalidateQueries({ queryKey: ['projection'] });
      await qc.invalidateQueries({ queryKey: ['couple-balance'] });
      await qc.invalidateQueries({ queryKey: ['couple-transactions'] });
      // Best-effort push if this pushed a budget past 80% / 100% (for me or my partner).
      if (txType === 'expense') triggerBudgetAlerts(supabase);
      toast.success(
        editTx
          ? 'Movimiento actualizado ✓'
          : useInstallments
            ? `${installments} cuotas guardadas ✓`
            : 'Guardado ✓',
      );
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
              {!editTx && (
                <button
                  onClick={() => {
                    onClose();
                    router.push('/ticket');
                  }}
                  className="text-xs font-bold px-3 py-1 rounded-full border flex items-center gap-1"
                  style={{ borderColor: '#ECE5DC', color: '#6B6459', background: '#FFFFFF' }}
                >
                  🧾 Escanear ticket
                </button>
              )}
            </div>
            <p
              className="text-5xl font-black tracking-tight"
              style={{ color: txType === 'expense' ? '#FF7F6B' : '#7EC8A4', fontVariantNumeric: 'tabular-nums' }}
            >
              {displayAmount}
            </p>
            <p className="text-sm mt-1" style={{ color: '#6B6459' }}>
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
                  color: txType === t ? '#FFFFFF' : '#6B6459',
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

          {/* Scope — explicit segmented control so it's clear whether the
              movement is personal (solo mío) or del hogar (compartido). */}
          <div className="px-4 mt-3">
            <p className="text-xs font-bold mb-1.5" style={{ color: '#6B6459' }}>¿De quién es este movimiento?</p>
            <div className="flex rounded-2xl overflow-hidden p-1 gap-1" style={{ background: '#ECE5DC' }}>
              {([
                { key: 'me' as const, label: '👤 Mío' },
                ...(effectivePartnerId
                  ? [{ key: 'partner' as const, label: `👥 ${effectivePartnerName}` }]
                  : []),
                { key: 'household' as const, label: '🏠 Hogar' },
              ]).map((o) => {
                const active = owner === o.key;
                return (
                  <button
                    key={o.key}
                    onClick={() => setOwner(o.key)}
                    className="flex-1 py-2 text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1"
                    style={{
                      background: active ? (o.key === 'household' ? '#7EC8A4' : '#FFFFFF') : 'transparent',
                      color: active ? (o.key === 'household' ? '#FFFFFF' : '#2D2D2D') : '#6B6459',
                    }}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Who paid — only for a "Hogar" movement, where either person could
              have fronted the money. For "Mío"/partner it's implied. */}
          {owner === 'household' && effectivePartnerId && (
            <div className="px-4 mt-3">
              <p className="text-xs font-bold mb-1.5" style={{ color: '#6B6459' }}>¿Quién pagó?</p>
              <div className="flex rounded-2xl overflow-hidden p-1 gap-1" style={{ background: '#ECE5DC' }}>
                {([
                  { key: 'me' as const, label: '👤 Yo' },
                  { key: 'partner' as const, label: `👥 ${effectivePartnerName}` },
                ]).map((o) => {
                  const active = paidBy === o.key;
                  return (
                    <button
                      key={o.key}
                      onClick={() => setPaidBy(o.key)}
                      className="flex-1 py-2 text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1"
                      style={{
                        background: active ? '#FFFFFF' : 'transparent',
                        color: active ? '#2D2D2D' : '#6B6459',
                      }}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Options row */}
          <div className="flex gap-2 px-4 mt-3 flex-wrap">
            {/* Shared */}
            <button
              onClick={() => setIsShared((v) => !v)}
              className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold border"
              style={{
                background: isShared ? '#FFE7E2' : '#FFFFFF',
                borderColor: isShared ? '#FF7F6B' : '#ECE5DC',
                color: isShared ? '#FF7F6B' : '#6B6459',
              }}
            >
              {isShared ? '🤝 Compartido' : '🤝 Dividir'}
            </button>

            {/* Account */}
            {visibleAccounts.length > 0 && (
              <select
                value={effectiveAccountId ?? ''}
                onChange={(e) => setAccountId(e.target.value || null)}
                className="px-3 py-2 rounded-xl text-xs font-bold border bg-white"
                style={{ borderColor: '#ECE5DC', color: '#2D2D2D' }}
              >
                <option value="">Sin cuenta</option>
                {visibleAccounts.map((a) => (
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

          {/* Split percentage — only when "Compartido" is on */}
          {isShared && (
            <div className="px-4 mt-3">
              {effectivePartnerId ? (
                <div className="rounded-2xl p-3 border" style={{ background: '#FFFFFF', borderColor: '#ECE5DC' }}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold" style={{ color: '#6B6459' }}>¿Cómo lo dividen?</p>
                    <div className="flex gap-1">
                      {[
                        { label: '50/50', v: 50 },
                        { label: 'Yo todo', v: 100 },
                        { label: `${effectivePartnerName}`, v: 0 },
                      ].map((p) => (
                        <button
                          key={p.label}
                          onClick={() => setMyShare(p.v)}
                          className="px-2 py-1 rounded-lg text-[11px] font-bold border"
                          style={{
                            background: myShare === p.v ? '#FFE7E2' : '#FFFFFF',
                            borderColor: myShare === p.v ? '#FF7F6B' : '#ECE5DC',
                            color: myShare === p.v ? '#FF7F6B' : '#6B6459',
                          }}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={myShare}
                    onChange={(e) => setMyShare(parseInt(e.target.value, 10))}
                    className="w-full"
                    style={{ accentColor: '#FF7F6B' }}
                  />
                  <div className="flex justify-between mt-1.5">
                    <div>
                      <p className="text-[11px]" style={{ color: '#6B6459' }}>Yo ({myShare}%)</p>
                      <p className="text-sm font-bold" style={{ color: '#2D2D2D' }}>{fmtNative(myShareNative)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px]" style={{ color: '#6B6459' }}>{effectivePartnerName} ({100 - myShare}%)</p>
                      <p className="text-sm font-bold" style={{ color: '#2D2D2D' }}>{fmtNative(partnerShareNative)}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-[11px]" style={{ color: '#B8860B' }}>
                  ⚠️ Invitá a tu pareja al hogar para poder dividir el gasto.
                </p>
              )}
            </div>
          )}

          {/* Cuotas (solo para gastos nuevos) */}
          {canInstallments && (
            <div className="px-4 mt-3">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-bold" style={{ color: '#6B6459' }}>Cuotas</p>
                {useInstallments && (
                  <p className="text-xs font-bold" style={{ color: '#FF7F6B' }}>
                    {installments} × {formatARS(perInstallment)} por mes
                  </p>
                )}
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                {[1, 3, 6, 9, 12, 18, 24].map((n) => (
                  <button
                    key={n}
                    onClick={() => setInstallments(n)}
                    className="flex-shrink-0 px-3.5 py-2 rounded-2xl text-sm font-bold border transition-colors"
                    style={{
                      background: installments === n ? '#FFE7E2' : '#FFFFFF',
                      borderColor: installments === n ? '#FF7F6B' : '#ECE5DC',
                      color: installments === n ? '#FF7F6B' : '#6B6459',
                    }}
                  >
                    {n === 1 ? '1 pago' : `${n}`}
                  </button>
                ))}
              </div>
            </div>
          )}

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
            <PrimaryButton
              onClick={handleSave}
              disabled={nativeAmount === 0}
              loading={saving}
              className="w-full py-4 text-lg"
            >
              {saving ? 'Guardando…' : 'Guardar'}
            </PrimaryButton>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
