'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { NumberKeypad } from '@/components/NumberKeypad';
import { useFx } from '@/hooks/useFx';
import { useHaptics } from '@/hooks/useHaptics';
import { useDragToDismiss } from '@/hooks/useDragToDismiss';
import { createClient } from '@/lib/supabase';
import { formatARS, formatUSD, usdToArs, arsToUsd, parseMoney, roundMoney, formatTypedAmount, evalMoneyExpr, hasMoneyOperator, formatExprDisplay } from '@/lib/format';
import { PrimaryButton } from '@/components/PrimaryButton';
import { todayISO, toLocalISO } from '@/lib/date';
import { triggerBudgetAlerts } from '@/lib/notifyBudgets';
import { FLAG_COLORS } from '@/lib/flags';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';

// Icon choices for the inline "create category" flow inside the sheet.
const CAT_ICONS = ['🏷️', '🛒', '🍕', '🚇', '💊', '🎭', '📚', '✈️', '🏠', '💼', '💵', '📱', '💻', '👗', '💰', '🎯', '🎮', '🐾', '🌿', '⚽'];

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
  initialType?: 'expense' | 'income' | 'transfer';
}

interface EditTx {
  id: string;
  amount: number;
  type: string;
  currency: string;
  category_id: string | null;
  account_id: string | null;
  transfer_account_id?: string | null;
  scope: string;
  is_shared: boolean;
  is_fixed?: boolean;
  flag?: string | null;
  merchant: string | null;
  occurred_on: string;
  installment_total?: number | null;
  // Whose movement it is. Optional because not every edit caller selects it;
  // when missing we treat it as mine.
  profile_id?: string | null;
}

interface SavedSplit {
  amount: number;
  payer_profile_id: string;
  ower_profile_id: string;
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
  const haptic = useHaptics();
  // Drag the grabber down to dismiss (mobile). dragY stays 0 on desktop — the
  // handle is sm:hidden — so it never fights the centered-dialog transform.
  const { dragY, dragging, handleProps } = useDragToDismiss(onClose);
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
  // The `accounts` prop doesn't carry currency (most callers don't fetch it),
  // but transfers need it to keep origin/destination in the same currency. Fetch
  // a light metadata list here so every mount point supports transfers.
  const { data: acctMeta = [] } = useQuery({
    queryKey: ['sheet-accounts', householdId],
    enabled: !!householdId && open,
    queryFn: async () => {
      const { data } = await supabase
        .from('accounts')
        .select('id, name, type, currency, owner_profile_id')
        .eq('household_id', householdId)
        .eq('archived', false)
        .order('name');
      return data ?? [];
    },
  });

  // How often each category has actually been used recently, so the chips can
  // surface everyday categories first instead of the alphabetical default
  // (which buried frequent ones behind once-a-month "Agua"/"Alquiler"). We look
  // at the last batch of movements so the order adapts to current habits.
  const { data: categoryUsage } = useQuery({
    queryKey: ['category-usage', householdId],
    enabled: !!householdId && open,
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('category_id')
        .eq('household_id', householdId)
        .not('category_id', 'is', null)
        .order('occurred_on', { ascending: false })
        .limit(400);
      const counts = new Map<string, number>();
      for (const row of data ?? []) {
        if (row.category_id) counts.set(row.category_id, (counts.get(row.category_id) ?? 0) + 1);
      }
      return counts;
    },
  });

  // Default split suggestion: when the household divides "según ingresos"
  // (households.split_mode), a new shared expense starts at each person's
  // share of the previous closed month's income instead of 50/50. The user
  // can always override with the slider; null = keep the 50/50 default.
  const { data: suggestedShare = null } = useQuery({
    queryKey: ['split-suggestion', householdId, profileId],
    enabled: !!householdId && open,
    staleTime: 1000 * 60 * 30,
    queryFn: async () => {
      const { data: hh } = await supabase
        .from('households')
        .select('split_mode')
        .eq('id', householdId)
        .maybeSingle();
      if (hh?.split_mode !== 'income') return null;
      const now = new Date();
      const start = toLocalISO(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      const end = toLocalISO(new Date(now.getFullYear(), now.getMonth(), 0));
      const { data: rows } = await supabase
        .from('transactions')
        .select('amount, currency, usd_rate_snapshot, profile_id')
        .eq('household_id', householdId)
        .eq('type', 'income')
        .gte('occurred_on', start)
        .lte('occurred_on', end);
      let mine = 0;
      let total = 0;
      for (const r of rows ?? []) {
        const ars = r.currency === 'USD' ? r.amount * (Number(r.usd_rate_snapshot) || arsPerUsd) : r.amount;
        total += ars;
        if (r.profile_id === profileId) mine += ars;
      }
      if (total <= 0) return null;
      // Snap to the slider's step of 5 so the control reflects the suggestion.
      return Math.min(95, Math.max(5, Math.round((mine / total) * 20) * 5));
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
  const [txType, setTxType] = useState<'expense' | 'income' | 'transfer'>('expense');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  // Destination account for a transfer (money arrives here). Origin reuses accountId.
  const [toAccountId, setToAccountId] = useState<string | null>(null);
  // Who the movement belongs to: mine, my partner's (loaded on their behalf,
  // with their accounts), or the shared household.
  const [owner, setOwner] = useState<'me' | 'partner' | 'household'>('me');
  const [isShared, setIsShared] = useState(false);
  // Fixed expense (rent, psychologist, etc.): excluded from the weekly total
  // limit, but still counts in category budgets and monthly totals.
  const [isFixed, setIsFixed] = useState(false);
  const [flag, setFlag] = useState<string | null>(null);
  // Who actually fronted the money. Only meaningful for a "Hogar" movement:
  // a "Mío"/partner movement is paid by that same person. Decoupling this from
  // the owner is what lets a household expense be paid by either person (and
  // stay visible to both) instead of always assuming the creator paid.
  const [paidBy, setPaidBy] = useState<'me' | 'partner'>('me');
  // Percentage of a shared expense that *I* cover. Partner owes the rest.
  const [myShare, setMyShare] = useState(50);
  // The split row saved in the DB for the movement being edited, loaded async.
  // `splitLoaded` flips once the query resolved (even when there is no split),
  // so the save path can tell "no split" apart from "didn't load yet".
  const [savedSplit, setSavedSplit] = useState<SavedSplit | null>(null);
  const [splitLoaded, setSplitLoaded] = useState(false);
  // FX rate captured when the movement was originally saved (USD rows only).
  const [editRateSnapshot, setEditRateSnapshot] = useState<number | null>(null);
  // Whether the user actually touched the share control this session. While
  // false, edits keep the saved split's exact ratio instead of re-deriving it
  // from the (rounded) slider state — so fixing a typo in the description can
  // never change who owes whom.
  const splitDirtyRef = useRef(false);
  function userSetShare(v: number) {
    splitDirtyRef.current = true;
    setMyShare(v);
  }
  const [merchant, setMerchant] = useState('');
  const [date, setDate] = useState(todayISO());
  const [installments, setInstallments] = useState(1);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Inline "create category" flow, reachable from the category chips so you can
  // add a missing category without leaving the add-expense sheet.
  const [creatingCat, setCreatingCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatIcon, setNewCatIcon] = useState('🏷️');
  const [savingCat, setSavingCat] = useState(false);

  useEffect(() => {
    if (open) {
      if (editTx) {
        setRaw(String(editTx.amount).replace('.', ','));
        setTxType(editTx.type as 'expense' | 'income' | 'transfer');
        setCategoryId(editTx.category_id);
        // 'none' keeps an account-less movement account-less (null means "no
        // choice yet" and falls back to the first visible account).
        setAccountId(editTx.account_id ?? 'none');
        setToAccountId(editTx.transfer_account_id ?? null);
        setOwner(ownerOf(editTx));
        setIsShared(editTx.is_shared);
        setIsFixed(editTx.is_fixed ?? false);
        setFlag(editTx.flag ?? null);
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
        setToAccountId(null);
        setOwner('me');
        setIsShared(false);
        setIsFixed(false);
        setFlag(null);
        setPaidBy('me');
        setMerchant('');
        setDate(todayISO());
        setInputUSD(false);
        // Income-proportional default when the household uses that mode and
        // the suggestion already resolved; plain 50/50 otherwise.
        setMyShare(suggestedShare ?? 50);
      }
      setInstallments(1);
      setCreatingCat(false);
      setNewCatName('');
      setNewCatIcon('🏷️');
      setSavedSplit(null);
      setSplitLoaded(!editTx); // nothing to load for a brand-new movement
      setEditRateSnapshot(null);
      splitDirtyRef.current = false;
    }
    // suggestedShare intentionally omitted: it's only read as the initial
    // value at open; the late-resolve case is handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editTx, initialType]);

  // If the split suggestion resolves AFTER the sheet opened (first use, cold
  // cache), apply it — but never over a value the user already touched.
  useEffect(() => {
    if (!open || editTx || suggestedShare == null || splitDirtyRef.current) return;
    setMyShare(suggestedShare);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editTx, suggestedShare]);

  // When editing, load the saved split (and the FX snapshot the row was stored
  // with) so the percentage control reflects how it was actually divided and
  // the save path can tell whether the split really needs rewriting.
  useEffect(() => {
    if (!open || !editTx) return;
    // Corrupted edit state: a movement was opened without an id (we've seen this
    // surface very rarely on mobile). Don't fire a "id=eq.undefined" query —
    // mark the split loaded so the sheet is usable and let handleSave block.
    if (!editTx.id) { setSplitLoaded(true); return; }
    let cancelled = false;
    (async () => {
      const { data: row } = await supabase
        .from('transactions')
        .select('usd_rate_snapshot, splits(amount, payer_profile_id, ower_profile_id)')
        .eq('id', editTx.id)
        .maybeSingle();
      if (cancelled) return;
      const split: SavedSplit | null = row?.splits?.[0] ?? null;
      setSavedSplit(split);
      setEditRateSnapshot(row?.usd_rate_snapshot != null ? Number(row.usd_rate_snapshot) : null);
      setSplitLoaded(true);
      if (!editTx.is_shared || editTx.amount <= 0 || splitDirtyRef.current) return;
      // profile_id is the payer; if it's mine I paid, so my share is the
      // remainder, otherwise the split amount is directly my (the ower's) share.
      const iPaid = editTx.profile_id ? editTx.profile_id === profileId : ownerOf(editTx) !== 'partner';
      if (!split) {
        // Shared but never divided ("Yo todo" / "Pareja todo"): the payer
        // covers 100%. Defaulting to 50 here used to re-create a phantom
        // 50/50 split on the next save.
        setMyShare(iPaid ? 100 : 0);
        return;
      }
      // Convert with the rate the row was saved at, not today's — otherwise a
      // USD expense reopened after a devaluation shows the wrong percentages.
      const rate = row?.usd_rate_snapshot != null ? Number(row.usd_rate_snapshot) : arsPerUsd;
      const arsTotal = editTx.currency === 'USD' ? usdToArs(editTx.amount, rate) : editTx.amount;
      if (arsTotal <= 0) return;
      // split.amount is what the OWER owes the payer. If I paid, the ower is my
      // partner so my share is the remainder; if my partner paid (the movement
      // is theirs), the ower is me so the split is directly my share.
      const owerPct = Math.round((split.amount / arsTotal) * 100);
      setMyShare(Math.min(100, Math.max(0, iPaid ? 100 - owerPct : owerPct)));
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally NOT depending on arsPerUsd: the split is loaded once when the
    // sheet opens for editing. Re-running on every FX refresh would snap the
    // slider back to the saved value and discard a percentage the user just set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editTx]);

  // Refresh every query a money change can touch, so all pages stay in sync
  // after a save or delete (balances, budgets, analytics, couple balance).
  async function invalidateMoneyQueries() {
    await Promise.all(
      [
        'transactions',
        'account-tx',
        'spent-by-category',
        'category-usage',
        'category-month-totals',
        'budget-expense-rows',
        'summary',
        'projection',
        'couple-balance',
        'couple-transactions',
        // The category detail screen lists movements under this key — without
        // it, deleting from there looks like a no-op until a full reload.
        'category-tx',
        // The envelope budget (/presupuestos) derives its activity from these —
        // without them, re-categorising or editing a gasto only shows up after
        // reopening the app.
        'envelope-tx',
        'envelope',
      ].map((key) => qc.invalidateQueries({ queryKey: [key] })),
    );
  }

  async function handleDelete() {
    if (!editTx) return;
    setDeleting(true);
    try {
      // Splits have no ON DELETE CASCADE, so clear them before the parent row.
      await supabase.from('splits').delete().eq('transaction_id', editTx.id);
      const { error } = await supabase.from('transactions').delete().eq('id', editTx.id);
      if (error) throw error;
      await invalidateMoneyQueries();
      toast.success('Movimiento eliminado');
      setConfirmDelete(false);
      onClose();
    } catch (e) {
      toast.error('No se pudo eliminar. Intentá de nuevo.');
      console.error(e);
    } finally {
      setDeleting(false);
    }
  }

  function addMonthsISO(iso: string, k: number) {
    const [y, m, d] = iso.split('-').map(Number);
    // Clamp to the target month's last day so a purchase on the 31st doesn't
    // roll a cuota into the following month (Jan 31 + 1 month ≠ Mar 3).
    const lastDay = new Date(y, m - 1 + k + 1, 0).getDate();
    const dt = new Date(y, m - 1 + k, Math.min(d, lastDay));
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }

  // `raw` is an arithmetic expression (e.g. "1200+350"); the digit/comma caps
  // apply to the operand currently being typed — the part after the last
  // operator — not the whole string.
  function currentOperand(s: string) {
    const lastOp = Math.max(s.lastIndexOf('+'), s.lastIndexOf('-'), s.lastIndexOf('*'), s.lastIndexOf('/'));
    return s.slice(lastOp + 1);
  }

  function handleDigit(d: string) {
    haptic('tap');
    setRaw((prev) => {
      const operand = currentOperand(prev);
      if (d === ',') {
        if (operand.includes(',')) return prev; // only one decimal separator per operand
        return operand === '' ? prev + '0,' : prev + ',';
      }
      // cap decimals at 2 places
      if (operand.includes(',') && (operand.split(',')[1]?.length ?? 0) >= 2) return prev;
      const next = prev + d;
      if (currentOperand(next).replace(/\D/g, '').length > 12) return prev;
      return next;
    });
  }

  function handleOperator(op: string) {
    haptic('tap');
    setRaw((prev) => {
      if (prev === '') return prev; // no leading operator
      const last = prev[prev.length - 1];
      if ('+-*/'.includes(last)) return prev.slice(0, -1) + op; // swap a just-typed operator
      if (last === ',') return prev.slice(0, -1) + op; // drop a dangling decimal comma
      return prev + op;
    });
  }

  function handleBackspace() {
    haptic('tap');
    setRaw((prev) => prev.slice(0, -1));
  }

  const isTransfer = txType === 'transfer';

  // Transfers move money between the user's own non-credit accounts. Origin
  // reuses `accountId`; destination is `toAccountId`. We keep both legs in the
  // same currency so the stored amount applies cleanly to each balance.
  const transferAccounts = acctMeta.filter(
    (a) => a.type !== 'credit' && (a.owner_profile_id == null || a.owner_profile_id === profileId),
  );
  const effectiveFromId =
    accountId && transferAccounts.some((a) => a.id === accountId)
      ? accountId
      : (transferAccounts[0]?.id ?? null);
  const transferCurrency = (transferAccounts.find((a) => a.id === effectiveFromId)?.currency ??
    'ARS') as 'ARS' | 'USD';
  const destAccounts = transferAccounts.filter(
    (a) => a.id !== effectiveFromId && a.currency === transferCurrency,
  );
  const effectiveToId =
    toAccountId && destAccounts.some((a) => a.id === toAccountId)
      ? toAccountId
      : (destAccounts[0]?.id ?? null);

  // The transaction is stored in its native currency (USD stays USD instead of
  // being force-converted to ARS), so USD accounts/income keep correct balances.
  // A transfer's currency is fixed by its origin account.
  // The keypad allows quick math: when an operator is present, `raw` is an
  // expression we evaluate; otherwise it's a plain typed amount.
  const isExpr = hasMoneyOperator(raw);
  const nativeAmount = isExpr ? evalMoneyExpr(raw) : parseMoney(raw);
  const txCurrency: 'ARS' | 'USD' = isTransfer ? transferCurrency : inputUSD ? 'USD' : 'ARS';
  // ARS equivalent, used only for the couple-split math and the ≈ preview.
  const arsAmount = txCurrency === 'USD' ? usdToArs(nativeAmount, arsPerUsd) : nativeAmount;

  // No operator: show exactly what was typed (comma visible the instant it's
  // pressed, trailing zeros preserved). With an operator: show the running
  // result as the big number and the formula below it.
  const displayAmount = isExpr
    ? txCurrency === 'USD'
      ? formatUSD(nativeAmount)
      : formatARS(nativeAmount)
    : formatTypedAmount(raw, txCurrency);

  const secondaryAmount = isExpr
    ? formatExprDisplay(raw)
    : txCurrency === 'USD'
      ? `≈ ${formatARS(arsAmount)}`
      : `≈ ${formatUSD(arsToUsd(arsAmount, arsPerUsd))}`;

  // Neutral blue accent for transfers; red for expense, green for income.
  const accentColor = isTransfer ? '#4E84E0' : txType === 'expense' ? '#FF6F61' : '#2FA37C';
  const transferInvalid =
    isTransfer && (!effectiveFromId || !effectiveToId || effectiveFromId === effectiveToId);

  // Most-used categories first; alphabetical as a stable tiebreak so unused
  // ones still keep a predictable order. The incoming list is already filtered
  // to this kind, and .filter() returns a fresh array so the .sort() is safe.
  const visibleCategories = categories
    .filter((c) => c.kind === txType)
    .sort((a, b) => {
      const ua = categoryUsage?.get(a.id) ?? 0;
      const ub = categoryUsage?.get(b.id) ?? 0;
      if (ub !== ua) return ub - ua;
      return a.name.localeCompare(b.name);
    });

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
  // Fall back to the internally-fetched account list when the opening page
  // didn't pass any (e.g. the FAB on Categorías/Análisis), so you can still
  // pick the account that was used.
  const baseAccounts: Account[] = accounts.length > 0 ? accounts : acctMeta;
  const visibleAccounts = baseAccounts.filter(
    (a) => a.owner_profile_id == null || a.owner_profile_id === txProfileId,
  );

  // 'none' is an explicit "Sin cuenta" choice. A real selection that's no
  // longer offered (e.g. the payer changed, hiding their partner's accounts)
  // also becomes "Sin cuenta" — silently debiting some other account would be
  // worse. Only the "no choice yet" null falls back to the first visible one.
  const effectiveAccountId =
    accountId === 'none'
      ? null
      : accountId && visibleAccounts.some((a) => a.id === accountId)
        ? accountId
        : accountId
          ? null
          : (visibleAccounts[0]?.id ?? null);

  // Cuotas: only for new expenses. The entered amount is the TOTAL purchase,
  // split into N monthly charges.
  const canInstallments = txType === 'expense' && !editTx;
  const useInstallments = canInstallments && installments > 1;
  // Work in integer cents so cuotas split cleanly; the last cuota absorbs the
  // remainder so the cuotas always sum back to the exact total.
  const totalCents = Math.round(nativeAmount * 100);
  const baseCents = installments > 0 ? Math.floor(totalCents / installments) : totalCents;
  const perInstallment = baseCents / 100;

  // Shared split: I cover `myShare`% of the bill; the other person owes the
  // rest. We can only divide when we actually know who the partner is.
  // Splitting only makes sense for expenses — a "shared income" would make the
  // partner owe the receiver part of their salary, which is always a mis-tap.
  const sharedEffective = isShared && txType === 'expense';
  const canSplit = sharedEffective && !!effectivePartnerId;
  // The ower's percentage of the bill. myShare is always *my* percentage, so
  // the ower's cut is the complement when I paid, or my own cut when I owe.
  const owerPct = iAmPayer ? 100 - myShare : myShare;
  // How much the ower owes the payer, in ARS, for a given ARS amount.
  const owedArs = (ars: number) => roundMoney((ars * owerPct) / 100);
  // Live preview amounts in the entered currency.
  const partnerShareNative = roundMoney((nativeAmount * (100 - myShare)) / 100);
  const myShareNative = roundMoney(nativeAmount - partnerShareNative);
  const fmtNative = (n: number) => (inputUSD ? formatUSD(n) : formatARS(n));

  async function handleCreateCategory() {
    const name = newCatName.trim();
    if (!name) {
      toast.error('Ingresá un nombre.');
      return;
    }
    setSavingCat(true);
    try {
      const { data, error } = await supabase
        .from('categories')
        .insert({
          household_id: householdId,
          name,
          icon: newCatIcon,
          // New category is created for whatever the sheet is currently adding.
          kind: txType,
          is_default: false,
        })
        .select('id')
        .single();
      if (error || !data) throw error ?? new Error('No se pudo crear');
      await qc.invalidateQueries({ queryKey: ['categories'] });
      // Auto-select the freshly created category for this movement.
      setCategoryId(data.id);
      setCreatingCat(false);
      setNewCatName('');
      setNewCatIcon('🏷️');
      toast.success('Categoría creada ✓');
    } catch (e) {
      toast.error('No se pudo crear la categoría.');
      console.error(e);
    } finally {
      setSavingCat(false);
    }
  }

  async function handleSave() {
    if (nativeAmount === 0 || transferInvalid) return;
    // Guard against a corrupted edit reference (editTx present but no id): saving
    // would PATCH `id=eq.undefined` and fail with a confusing generic error.
    // Reopening the movement reloads it with a valid id.
    if (editTx && !editTx.id) {
      toast.error('No se pudo identificar el movimiento. Cerralo y abrilo de nuevo.');
      return;
    }
    haptic('success');
    // Close the sheet right away so the add flow feels instant. Every value the
    // write needs is already captured in this closure, so the insert/update runs
    // to completion in the background; a toast reports the outcome and the lists
    // refetch on success (invalidateMoneyQueries). On error nothing was committed.
    setSaving(true);
    onClose();
    try {
      if (isTransfer) {
        // A transfer is ONE row: money leaves account_id (origin) and arrives at
        // transfer_account_id (destination). It carries no category/split and is
        // ignored by income/expense analytics; only balances react to it.
        const transferPayload = {
          household_id: householdId,
          profile_id: profileId,
          type: 'transfer' as const,
          amount: nativeAmount,
          currency: txCurrency,
          usd_rate_snapshot: arsPerUsd,
          category_id: null,
          account_id: effectiveFromId,
          transfer_account_id: effectiveToId,
          merchant: merchant || null,
          occurred_on: date,
          scope: 'personal' as const,
          is_shared: false,
          source: 'manual' as const,
        };
        if (editTx) {
          const { error } = await supabase.from('transactions').update(transferPayload).eq('id', editTx.id);
          if (error) throw error;
          // If this row used to be a shared expense, drop any stale split.
          const { error: delErr } = await supabase.from('splits').delete().eq('transaction_id', editTx.id);
          if (delErr) throw delErr;
        } else {
          const { error } = await supabase.from('transactions').insert(transferPayload);
          if (error) throw error;
        }

        await invalidateMoneyQueries();
        toast.success(editTx ? 'Transferencia actualizada ✓' : 'Transferencia guardada ✓');
        onClose();
        return;
      }

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
        is_shared: sharedEffective,
        // Only expenses can be "fixed"; income/transfers never are.
        is_fixed: txType === 'expense' ? isFixed : false,
        flag,
        source: 'manual' as const,
      };

      if (editTx) {
        // Make sure we know the saved split before deciding whether to rewrite
        // it (the async load may not have resolved if the user saved fast).
        let currentSplit = savedSplit;
        let rateSnap = editRateSnapshot;
        if (!splitLoaded) {
          const { data: row } = await supabase
            .from('transactions')
            .select('usd_rate_snapshot, splits(amount, payer_profile_id, ower_profile_id)')
            .eq('id', editTx.id)
            .maybeSingle();
          currentSplit = row?.splits?.[0] ?? null;
          rateSnap = row?.usd_rate_snapshot != null ? Number(row.usd_rate_snapshot) : null;
        }

        const amountChanged = nativeAmount !== Number(editTx.amount);
        const currencyChanged = txCurrency !== editTx.currency;
        // Preserve the historical FX snapshot on edits — a merchant-name fix
        // must not re-price an old USD expense at today's rate. Only refresh it
        // when the currency changed (the old snapshot belongs to the other
        // currency) or the row never had one.
        const updatePayload: Partial<typeof payload> = { ...payload };
        if (!currencyChanged && rateSnap != null) {
          delete updatePayload.usd_rate_snapshot;
        }

        const { error } = await supabase
          .from('transactions')
          .update(updatePayload)
          .eq('id', editTx.id);
        if (error) throw error;

        // Re-sync the split to match the current shared/percentage choice —
        // but ONLY when something split-relevant actually changed. Editing an
        // unrelated field must never rewrite who owes whom.
        // When "Compartido" is on but the partner profile isn't known (yet),
        // leave the existing split untouched rather than deleting it blind.
        if (!(sharedEffective && !effectivePartnerId)) {
          const payerChanged = (editTx.profile_id ?? profileId) !== txProfileId;
          const sharedChanged = sharedEffective !== editTx.is_shared;
          const needsRewrite =
            splitDirtyRef.current || amountChanged || currencyChanged || sharedChanged || payerChanged;

          if (needsRewrite) {
            // Rate for ARS conversion of the split: keep the row's snapshot
            // while the currency is unchanged, so the couple debt isn't
            // silently re-priced.
            const splitRate =
              txCurrency === 'USD' && !currencyChanged && rateSnap ? rateSnap : arsPerUsd;
            const arsForSplit = txCurrency === 'USD' ? usdToArs(nativeAmount, splitRate) : nativeAmount;

            let owedNew = owedArs(arsForSplit);
            if (!splitDirtyRef.current && currentSplit && editTx.is_shared) {
              // The user didn't touch the slider: carry the saved split's
              // EXACT ratio over to the new amount instead of the slider's
              // integer-rounded percentage (33,333% must stay 33,333%).
              const oldRate = rateSnap ?? arsPerUsd;
              const oldArs =
                editTx.currency === 'USD' ? usdToArs(Number(editTx.amount), oldRate) : Number(editTx.amount);
              if (oldArs > 0) {
                const oldFrac = Math.min(1, Math.max(0, currentSplit.amount / oldArs));
                const frac = currentSplit.payer_profile_id === payerId ? oldFrac : 1 - oldFrac;
                owedNew = roundMoney(arsForSplit * frac);
              }
            }

            const desired =
              canSplit && owedNew > 0
                ? { amount: owedNew, payer_profile_id: payerId!, ower_profile_id: owerId! }
                : null;
            const unchanged =
              (desired === null && currentSplit === null) ||
              (desired !== null &&
                currentSplit !== null &&
                currentSplit.amount === desired.amount &&
                currentSplit.payer_profile_id === desired.payer_profile_id &&
                currentSplit.ower_profile_id === desired.ower_profile_id);

            if (!unchanged) {
              const { error: delErr } = await supabase
                .from('splits')
                .delete()
                .eq('transaction_id', editTx.id);
              if (delErr) throw delErr;
              if (desired) {
                const { error: insErr } = await supabase.from('splits').insert({
                  transaction_id: editTx.id,
                  ...desired,
                });
                if (insErr) throw insErr;
              }
            }
          }
        }
      } else if (useInstallments) {
        // Split the total into N monthly charges (one transaction per cuota).
        const groupId = crypto.randomUUID();
        const rows = Array.from({ length: installments }, (_, k) => ({
          ...payload,
          // last cuota absorbs the rounding remainder (math in cents)
          amount:
            k === installments - 1
              ? roundMoney((totalCents - baseCents * (installments - 1)) / 100)
              : perInstallment,
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
          if (splitRows.length > 0) {
            const { error: splitErr } = await supabase.from('splits').insert(splitRows);
            if (splitErr) throw splitErr;
          }
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
          const { error: splitErr } = await supabase.from('splits').insert({
            transaction_id: tx.id,
            payer_profile_id: payerId!,
            ower_profile_id: owerId!,
            amount: owed,
          });
          if (splitErr) throw splitErr;
        }
      }

      await invalidateMoneyQueries();
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
        className="rounded-t-3xl sm:rounded-3xl p-0 gap-0 overflow-hidden flex flex-col"
        style={{
          background: '#F1F5F3',
          maxHeight: '95dvh',
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          transition: dragging ? 'none' : undefined,
        }}
      >
        {/* drag handle (mobile only — on desktop this renders as a centered
            dialog). Drag it down to dismiss. */}
        <div className="flex justify-center pt-3 pb-2 sm:hidden shrink-0 touch-none" {...handleProps}>
          <div className="w-10 h-1 rounded-full" style={{ background: '#E5EBE8' }} />
        </div>
        <div className="hidden sm:block pt-5 shrink-0" />
        <div className="overflow-y-auto flex flex-col flex-1 min-h-0">

          {/* Amount display */}
          <div className="text-center px-6 pb-2">
            <div className="flex items-center justify-center gap-3 mb-1">
              {isTransfer ? (
                <span
                  className="text-xs font-bold px-3 py-1 rounded-full border"
                  style={{ borderColor: '#4E84E0', color: '#4E84E0' }}
                >
                  {txCurrency}
                </span>
              ) : (
                <button
                  onClick={() => setInputUSD((v) => !v)}
                  className="text-xs font-bold px-3 py-1 rounded-full border"
                  style={{
                    borderColor: inputUSD ? '#FF6F61' : '#2FA37C',
                    color: inputUSD ? '#FF6F61' : '#2FA37C',
                  }}
                >
                  {inputUSD ? 'USD' : 'ARS'}
                </button>
              )}
              {!editTx ? (
                <button
                  onClick={() => {
                    onClose();
                    router.push('/ticket');
                  }}
                  className="text-xs font-bold px-3 py-1 rounded-full border flex items-center gap-1"
                  style={{ borderColor: '#E5EBE8', color: '#5B6660', background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}
                >
                  🧾 Escanear ticket
                </button>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="text-xs font-bold px-3 py-1 rounded-full border flex items-center gap-1"
                  style={{ borderColor: '#FF6F61', color: '#FF6F61', background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}
                >
                  🗑️ Eliminar
                </button>
              )}
            </div>
            <p
              className="text-5xl font-black tracking-tight"
              style={{ color: accentColor, fontVariantNumeric: 'tabular-nums' }}
            >
              {displayAmount}
            </p>
            <p className="text-sm mt-1" style={{ color: '#5B6660' }}>
              {secondaryAmount}
            </p>
          </div>

          {/* Gasto / Ingreso / Transferencia toggle */}
          <div className="flex mx-6 mb-3 rounded-2xl overflow-hidden" style={{ background: '#E5EBE8' }}>
            {([
              { t: 'expense' as const, label: 'Gasto', color: '#FF6F61' },
              { t: 'income' as const, label: 'Ingreso', color: '#2FA37C' },
              { t: 'transfer' as const, label: 'Transferencia', color: '#4E84E0' },
            ]).map(({ t, label, color }) => (
              <button
                key={t}
                onClick={() => {
                  setTxType(t);
                  setCategoryId(null);
                }}
                className="flex-1 py-2.5 text-[13px] font-bold transition-all"
                style={{
                  background: txType === t ? color : 'transparent',
                  color: txType === t ? '#FFFFFF' : '#5B6660',
                  borderRadius: '14px',
                  boxShadow: txType === t ? 'var(--shadow-soft)' : 'none',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Category chips */}
          {!isTransfer && (
          <div className="px-4 mb-3">
            <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
              {visibleCategories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCategoryId(categoryId === c.id ? null : c.id)}
                  className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-2xl text-sm font-semibold border transition-all"
                  style={{
                    background: categoryId === c.id ? '#DDF0E8' : '#FFFFFF',
                    borderColor: categoryId === c.id ? '#2FA37C' : '#E5EBE8',
                    color: categoryId === c.id ? '#1F8A68' : '#18211D',
                    boxShadow: categoryId === c.id ? '0 4px 12px -4px rgba(47,163,124,0.45)' : 'var(--shadow-soft)',
                  }}
                >
                  <span>{c.icon}</span>
                  <span>{c.name}</span>
                </button>
              ))}
              {/* Create a new category inline, without leaving the sheet. */}
              <button
                onClick={() => setCreatingCat((v) => !v)}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-2xl text-sm font-bold border border-dashed transition-colors"
                style={{
                  background: creatingCat ? '#DDF0E8' : '#FFFFFF',
                  borderColor: '#2FA37C',
                  color: '#1F8A68',
                }}
              >
                <span>＋</span>
                <span>Crear categoría</span>
              </button>
            </div>

            {/* Inline new-category form */}
            {creatingCat && (
              <div className="mt-2 rounded-2xl p-3 border" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)', borderColor: '#E5EBE8' }}>
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    autoFocus
                    placeholder={`Nueva categoría de ${txType === 'income' ? 'ingreso' : 'gasto'}`}
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCreateCategory(); }}
                    className="flex-1 min-w-0 px-3 py-2 rounded-xl border text-sm outline-none"
                    style={{ borderColor: '#E5EBE8', color: '#18211D' }}
                  />
                  <button
                    onClick={handleCreateCategory}
                    disabled={!newCatName.trim() || savingCat}
                    className="flex-shrink-0 px-4 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                    style={{ background: '#2FA37C' }}
                  >
                    {savingCat ? '…' : 'Crear'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {CAT_ICONS.map((ic) => (
                    <button
                      key={ic}
                      onClick={() => setNewCatIcon(ic)}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-lg"
                      style={{
                        background: newCatIcon === ic ? '#DDF0E8' : '#F1F5F3',
                        border: newCatIcon === ic ? '2px solid #2FA37C' : '2px solid transparent',
                      }}
                    >
                      {ic}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          )}

          {/* Keypad */}
          <NumberKeypad onDigit={handleDigit} onBackspace={handleBackspace} onOperator={handleOperator} />

          {/* Transfer: origin → destination accounts (same currency). */}
          {isTransfer && (
            <div className="px-4 mt-3">
              {transferAccounts.length < 2 ? (
                <p className="text-[11px]" style={{ color: '#B8860B' }}>
                  ⚠️ Necesitás al menos dos cuentas tuyas (no tarjetas) de la misma moneda para transferir.
                </p>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <p className="text-[11px] font-bold mb-1" style={{ color: '#5B6660' }}>Desde</p>
                    <select
                      value={effectiveFromId ?? ''}
                      onChange={(e) => setAccountId(e.target.value || null)}
                      className="w-full px-3 py-2.5 rounded-xl text-xs font-bold border bg-white"
                      style={{ borderColor: '#E5EBE8', color: '#18211D' }}
                    >
                      {transferAccounts.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                  <span className="text-xl mt-4" style={{ color: '#4E84E0' }}>→</span>
                  <div className="flex-1">
                    <p className="text-[11px] font-bold mb-1" style={{ color: '#5B6660' }}>Hacia</p>
                    <select
                      value={effectiveToId ?? ''}
                      onChange={(e) => setToAccountId(e.target.value || null)}
                      className="w-full px-3 py-2.5 rounded-xl text-xs font-bold border bg-white"
                      style={{ borderColor: '#E5EBE8', color: '#18211D' }}
                    >
                      {destAccounts.length === 0 && <option value="">Sin destino</option>}
                      {destAccounts.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
              {/* Date */}
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-3 px-3 py-2 rounded-xl text-xs font-bold border bg-white"
                style={{ borderColor: '#E5EBE8', color: '#18211D' }}
              />
            </div>
          )}

          {/* Scope — explicit segmented control so it's clear whether the
              movement is personal (solo mío) or del hogar (compartido). */}
          {!isTransfer && (
          <div className="px-4 mt-3">
            <p className="text-xs font-bold mb-1.5" style={{ color: '#5B6660' }}>¿De quién es este movimiento?</p>
            <div className="flex rounded-2xl overflow-hidden p-1 gap-1" style={{ background: '#E5EBE8' }}>
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
                    className="flex-1 py-2 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1"
                    style={{
                      background: active ? (o.key === 'household' ? '#2FA37C' : '#FFFFFF') : 'transparent',
                      color: active ? (o.key === 'household' ? '#FFFFFF' : '#18211D') : '#5B6660',
                      boxShadow: active ? 'var(--shadow-soft)' : 'none',
                    }}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
          )}

          {/* Who paid — only for a "Hogar" movement, where either person could
              have fronted the money. For "Mío"/partner it's implied. */}
          {owner === 'household' && effectivePartnerId && (
            <div className="px-4 mt-3">
              <p className="text-xs font-bold mb-1.5" style={{ color: '#5B6660' }}>¿Quién pagó?</p>
              <div className="flex rounded-2xl overflow-hidden p-1 gap-1" style={{ background: '#E5EBE8' }}>
                {([
                  { key: 'me' as const, label: '👤 Yo' },
                  { key: 'partner' as const, label: `👥 ${effectivePartnerName}` },
                ]).map((o) => {
                  const active = paidBy === o.key;
                  return (
                    <button
                      key={o.key}
                      onClick={() => setPaidBy(o.key)}
                      className="flex-1 py-2 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1"
                      style={{
                        background: active ? '#FFFFFF' : 'transparent',
                        color: active ? '#18211D' : '#5B6660',
                        boxShadow: active ? 'var(--shadow-soft)' : 'none',
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
          {!isTransfer && (
          <div className="flex gap-2 px-4 mt-3 flex-wrap">
            {/* Shared — expenses only; splitting an income makes no sense. */}
            {txType === 'expense' && (
            <button
              onClick={() => setIsShared((v) => !v)}
              className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold border"
              style={{
                background: isShared ? '#FFE5E0' : '#FFFFFF',
                borderColor: isShared ? '#FF6F61' : '#E5EBE8',
                color: isShared ? '#FF6F61' : '#5B6660',
              }}
            >
              {isShared ? '🤝 Compartido' : '🤝 Dividir'}
            </button>
            )}

            {/* Fixed expense — excluded from the weekly total limit. */}
            {txType === 'expense' && (
            <button
              onClick={() => setIsFixed((v) => !v)}
              className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold border"
              style={{
                background: isFixed ? '#E9F1FD' : '#FFFFFF',
                borderColor: isFixed ? '#4E84E0' : '#E5EBE8',
                color: isFixed ? '#4E84E0' : '#5B6660',
              }}
            >
              {isFixed ? '📌 Gasto fijo' : '📌 Fijo'}
            </button>
            )}

            {/* Account */}
            {visibleAccounts.length > 0 && (
              <select
                value={effectiveAccountId ?? ''}
                onChange={(e) => setAccountId(e.target.value || 'none')}
                className="px-3 py-2 rounded-xl text-xs font-bold border bg-white"
                style={{ borderColor: '#E5EBE8', color: '#18211D' }}
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
              style={{ borderColor: '#E5EBE8', color: '#18211D' }}
            />

            {/* Colour flag — discs stay small but each gets a ~36px tap target. */}
            <div className="flex items-center gap-0.5 px-1 rounded-xl border" style={{ borderColor: '#E5EBE8' }}>
              <button type="button" onClick={() => setFlag(null)} title="Sin flag" aria-label="Sin flag" className="w-9 h-9 rounded-full flex items-center justify-center">
                <span className="w-5 h-5 rounded-full border flex items-center justify-center text-[10px]" style={{ borderColor: flag === null ? '#18211D' : '#E5EBE8', color: '#5B6660' }}>○</span>
              </button>
              {FLAG_COLORS.map((f) => (
                <button key={f.key} type="button" onClick={() => setFlag(f.key)} title={f.label} aria-label={f.label} className="w-9 h-9 rounded-full flex items-center justify-center">
                  <span className="w-5 h-5 rounded-full block" style={{ background: f.hex, outline: flag === f.key ? '2px solid #18211D' : 'none', outlineOffset: '1px' }} />
                </button>
              ))}
            </div>
          </div>
          )}

          {/* Hint for the fixed-expense toggle. */}
          {!isTransfer && txType === 'expense' && isFixed && (
            <p className="px-4 mt-2 text-[11px]" style={{ color: '#5B6660' }}>
              📌 Gasto fijo (recurrente, tipo alquiler o servicios).
            </p>
          )}

          {/* Split percentage — only when "Compartido" is on */}
          {txType === 'expense' && isShared && (
            <div className="px-4 mt-3">
              {effectivePartnerId ? (
                <div className="rounded-2xl p-3 border" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)', borderColor: '#E5EBE8' }}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold" style={{ color: '#5B6660' }}>¿Cómo lo dividen?</p>
                    <div className="flex gap-1">
                      {[
                        { label: '50/50', v: 50 },
                        { label: 'Yo todo', v: 100 },
                        { label: `${effectivePartnerName}`, v: 0 },
                      ].map((p) => (
                        <button
                          key={p.label}
                          onClick={() => userSetShare(p.v)}
                          className="px-2 py-1 rounded-lg text-[11px] font-bold border"
                          style={{
                            background: myShare === p.v ? '#FFE5E0' : '#FFFFFF',
                            borderColor: myShare === p.v ? '#FF6F61' : '#E5EBE8',
                            color: myShare === p.v ? '#FF6F61' : '#5B6660',
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
                    onChange={(e) => userSetShare(parseInt(e.target.value, 10))}
                    className="w-full"
                    style={{ accentColor: '#FF6F61' }}
                  />
                  <div className="flex justify-between mt-1.5">
                    <div>
                      <p className="text-[11px]" style={{ color: '#5B6660' }}>Yo ({myShare}%)</p>
                      <p className="text-sm font-bold" style={{ color: '#18211D' }}>{fmtNative(myShareNative)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px]" style={{ color: '#5B6660' }}>{effectivePartnerName} ({100 - myShare}%)</p>
                      <p className="text-sm font-bold" style={{ color: '#18211D' }}>{fmtNative(partnerShareNative)}</p>
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
                <p className="text-xs font-bold" style={{ color: '#5B6660' }}>Cuotas</p>
                {useInstallments && (
                  <p className="text-xs font-bold" style={{ color: '#FF6F61' }}>
                    {installments} × {formatARS(perInstallment)} por mes
                  </p>
                )}
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                {[1, 2, 3, 6, 9, 12, 18, 24].map((n) => (
                  <button
                    key={n}
                    onClick={() => setInstallments(n)}
                    className="flex-shrink-0 px-3.5 py-2 rounded-2xl text-sm font-bold border transition-colors"
                    style={{
                      background: installments === n ? '#FFE5E0' : '#FFFFFF',
                      borderColor: installments === n ? '#FF6F61' : '#E5EBE8',
                      color: installments === n ? '#FF6F61' : '#5B6660',
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
              style={{ borderColor: '#E5EBE8', color: '#18211D' }}
            />
          </div>

          {/* breathing room so the last field clears the sticky save bar */}
          <div className="h-2 shrink-0" />
        </div>

        {/* Sticky save bar — always reachable without scrolling to the bottom of
            a long form. */}
        <div
          className="shrink-0 px-4 pt-3"
          style={{
            background: '#F1F5F3',
            borderTop: '1px solid #E5EBE8',
            paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))',
          }}
        >
          {txType === 'expense' && !categoryId && nativeAmount > 0 && (
            <p className="text-[11px] mb-2 text-center" style={{ color: '#C79A2B' }}>
              Elegí una categoría para que el gasto entre en un sobre.
            </p>
          )}
          <PrimaryButton
            onClick={handleSave}
            disabled={nativeAmount === 0 || transferInvalid || (txType === 'expense' && !categoryId)}
            loading={saving}
            className="w-full py-4 text-lg"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </PrimaryButton>
        </div>
      </SheetContent>
      <ConfirmDialog
        open={confirmDelete}
        title="¿Eliminar movimiento?"
        message={
          editTx?.installment_total && editTx.installment_total > 1
            ? 'Se elimina solo esta cuota. Las demás cuotas quedan registradas.'
            : 'Esta acción no se puede deshacer.'
        }
        confirmLabel={deleting ? 'Eliminando…' : 'Eliminar'}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </Sheet>
  );
}
