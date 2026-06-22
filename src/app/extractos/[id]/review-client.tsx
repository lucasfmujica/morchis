'use client';

import { useState, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { BottomNav } from '@/components/BottomNav';
import { MoneyInput } from '@/components/MoneyInput';
import { formatARS, parseMoney } from '@/lib/format';
import { useFx } from '@/hooks/useFx';
import { triggerBudgetAlerts } from '@/lib/notifyBudgets';
import { toast } from 'sonner';

interface Profile {
  id: string;
  household_id: string;
  nickname: string | null;
  display_name: string | null;
}

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

interface Statement {
  id: string;
  status: string;
  created_at: string;
  account_id: string | null;
}

interface DraftPayload {
  date: string;
  merchant: string;
  raw_description: string;
  amount: number;
  suggested_category: string;
  category_id: string | null;
  confidence: number;
}

interface Draft {
  id: string;
  statement_id: string;
  confidence: number | null;
  status: string;
  payload: DraftPayload;
}

// Edit modal component
function EditDraftModal({
  draft,
  categories,
  accounts,
  onSave,
  onClose,
}: {
  draft: Draft;
  categories: Category[];
  accounts: Account[];
  onSave: (d: Draft, merchantEdited: boolean) => void;
  onClose: () => void;
}) {
  const [merchant, setMerchant] = useState(draft.payload.merchant);
  const [amount, setAmount] = useState(String(draft.payload.amount));
  const [date, setDate] = useState(draft.payload.date);
  const [categoryId, setCategoryId] = useState(draft.payload.category_id ?? '');
  const originalMerchant = draft.payload.merchant;

  function save() {
    const updated: Draft = {
      ...draft,
      payload: {
        ...draft.payload,
        merchant,
        amount: parseMoney(amount) || draft.payload.amount,
        date,
        category_id: categoryId || null,
      },
    };
    onSave(updated, merchant !== originalMerchant);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl p-5 pb-8" style={{ background: '#FFFFFF' }}>
        <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: '#ECE5DC' }} />
        <h3 className="text-lg font-black mb-4" style={{ color: '#2D2D2D' }}>Editar movimiento</h3>

        <div className="flex flex-col gap-3">
          <div>
            <p className="text-xs font-bold mb-1" style={{ color: '#6B6459' }}>Comercio</p>
            <input
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              className="w-full px-4 py-3 rounded-2xl text-sm border outline-none"
              style={{ borderColor: '#ECE5DC', color: '#2D2D2D' }}
            />
          </div>
          <div>
            <p className="text-xs font-bold mb-1" style={{ color: '#6B6459' }}>Monto (ARS)</p>
            <MoneyInput
              value={parseMoney(amount)}
              onChange={(n) => setAmount(n ? String(n) : '')}
              className="w-full px-4 py-3 rounded-2xl text-sm border outline-none"
              style={{ borderColor: '#ECE5DC', color: '#2D2D2D' }}
            />
          </div>
          <div>
            <p className="text-xs font-bold mb-1" style={{ color: '#6B6459' }}>Fecha</p>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-4 py-3 rounded-2xl text-sm border outline-none"
              style={{ borderColor: '#ECE5DC', color: '#2D2D2D' }}
            />
          </div>
          <div>
            <p className="text-xs font-bold mb-1" style={{ color: '#6B6459' }}>Categoría</p>
            <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto">
              {categories.filter((c) => c.kind === 'expense').map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setCategoryId(cat.id)}
                  className="px-3 py-1.5 rounded-full text-xs font-bold border"
                  style={{
                    background: categoryId === cat.id ? '#2D2D2D' : 'transparent',
                    borderColor: categoryId === cat.id ? '#2D2D2D' : '#ECE5DC',
                    color: categoryId === cat.id ? '#FFFFFF' : '#6B6459',
                  }}
                >
                  {cat.icon} {cat.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          onClick={save}
          className="w-full mt-5 py-4 rounded-2xl text-sm font-black"
          style={{ background: '#7EC8A4', color: '#FFFFFF' }}
        >
          Guardar
        </button>
      </div>
    </div>
  );
}

// Single swipeable draft card
function DraftCard({
  draft,
  categories,
  pending,
  onAccept,
  onReject,
  onEdit,
}: {
  draft: Draft;
  categories: Category[];
  pending: boolean;
  onAccept: () => void;
  onReject: () => void;
  onEdit: () => void;
}) {
  const { format } = useFx();
  const touchStartX = useRef<number | null>(null);
  const [swipeX, setSwipeX] = useState(0);
  const [swiping, setSwiping] = useState(false);

  const cat = categories.find((c) => c.id === draft.payload.category_id);
  const conf = draft.payload.confidence ?? draft.confidence ?? 0;
  const highConf = conf >= 0.85;

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
    setSwiping(true);
  }

  function onTouchMove(e: React.TouchEvent) {
    if (touchStartX.current === null) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    setSwipeX(dx);
  }

  function onTouchEnd() {
    // Ignore swipe completion while an accept is in flight — a swipe followed
    // by a tap (or vice versa) must not fire the action twice.
    if (!pending) {
      if (swipeX > 80) onAccept();
      else if (swipeX < -80) onReject();
    }
    setSwipeX(0);
    setSwiping(false);
    touchStartX.current = null;
  }

  const swipeColor = swipeX > 40 ? '#7EC8A4' : swipeX < -40 ? '#FF7F6B' : '#FFFFFF';
  const swipeLabel = swipeX > 40 ? '✓ Aceptar' : swipeX < -40 ? '✗ Rechazar' : '';

  return (
    <div className="relative overflow-hidden rounded-3xl mb-3" style={{ background: swipeColor }}>
      {/* Swipe hint labels */}
      {swipeLabel && (
        <div
          className="absolute inset-0 flex items-center font-black text-white text-lg"
          style={{ paddingLeft: swipeX > 0 ? 20 : undefined, paddingRight: swipeX < 0 ? 20 : undefined, justifyContent: swipeX > 0 ? 'flex-start' : 'flex-end' }}
        >
          {swipeLabel}
        </div>
      )}

      {/* Card content */}
      <div
        className="relative rounded-3xl p-4"
        style={{
          background: '#FFFFFF',
          transform: swiping ? `translateX(${swipeX}px)` : 'translateX(0)',
          transition: swiping ? 'none' : 'transform 0.2s ease',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className="flex items-start gap-3">
          <span className="text-2xl mt-0.5">{cat?.icon ?? '🏷️'}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-black truncate" style={{ color: '#2D2D2D' }}>
                {draft.payload.merchant}
              </p>
              <p className="text-base font-black flex-shrink-0" style={{ color: '#FF7F6B' }}>
                −{formatARS(draft.payload.amount)}
              </p>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-xs" style={{ color: '#6B6459' }}>
                {new Date(draft.payload.date + 'T00:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}
              </p>
              {cat && (
                <span className="text-xs px-1.5 py-0.5 rounded-md font-semibold" style={{ background: '#E4F2EA', color: '#5BA886' }}>
                  {cat.name}
                </span>
              )}
              {highConf && (
                <span className="text-xs px-1.5 py-0.5 rounded-md font-semibold" style={{ background: '#E4F2EA', color: '#5BA886' }}>
                  ✓ Alta confianza
                </span>
              )}
            </div>
            <p className="text-[11px] mt-1 truncate" style={{ color: '#6B6459' }}>
              {draft.payload.raw_description}
            </p>
          </div>
        </div>

        {/* Action buttons — disabled while this draft's accept is in flight */}
        <div className="flex gap-2 mt-3">
          <button
            onClick={onReject}
            disabled={pending}
            className="flex-1 py-2 rounded-2xl text-xs font-bold disabled:opacity-50"
            style={{ background: '#FFE7E2', color: '#FF7F6B' }}
          >
            ✗ Rechazar
          </button>
          <button
            onClick={onEdit}
            disabled={pending}
            className="py-2 px-4 rounded-2xl text-xs font-bold disabled:opacity-50"
            style={{ background: '#ECE5DC', color: '#6B6459' }}
          >
            ✏️ Editar
          </button>
          <button
            onClick={onAccept}
            disabled={pending}
            className="flex-1 py-2 rounded-2xl text-xs font-bold disabled:opacity-50"
            style={{ background: '#E4F2EA', color: '#5BA886' }}
          >
            {pending ? '…' : '✓ Aceptar'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ReviewClient({
  profile,
  statement,
  categories,
  accounts,
}: {
  profile: Profile;
  statement: Statement;
  categories: Category[];
  accounts: Account[];
}) {
  const supabase = createClient();
  const qc = useQueryClient();
  const router = useRouter();
  const { arsPerUsd } = useFx();
  const [editingDraft, setEditingDraft] = useState<Draft | null>(null);
  const [accepting, setAccepting] = useState(false);

  // Draft ids with an accept in flight. The ref is the source of truth for the
  // re-entry guard (a double tap lands before a state update would re-render);
  // the state mirror exists only so the buttons re-render as disabled.
  const inFlightRef = useRef<Set<string>>(new Set());
  const [inFlight, setInFlight] = useState<Set<string>>(new Set());
  function markInFlight(ids: string[]) {
    for (const id of ids) inFlightRef.current.add(id);
    setInFlight(new Set(inFlightRef.current));
  }
  function clearInFlight(ids: string[]) {
    for (const id of ids) inFlightRef.current.delete(id);
    setInFlight(new Set(inFlightRef.current));
  }

  // The server-rendered `statement` prop never refreshes, so a statement opened
  // mid-parse would spin forever. Poll the row while it says 'parsing' so the
  // spinner clears on its own once the parser finishes (or fails).
  const { data: liveStatement = statement } = useQuery<Statement>({
    queryKey: ['statement', statement.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('statements')
        .select('id, status, created_at, account_id')
        .eq('id', statement.id)
        .single();
      return (data as Statement) ?? statement;
    },
    initialData: statement,
    refetchInterval: (query) => (query.state.data?.status === 'parsing' ? 3000 : false),
  });
  const statementStatus = liveStatement.status;

  const { data: drafts = [], isLoading } = useQuery<Draft[]>({
    queryKey: ['drafts', statement.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('draft_transactions')
        .select('id, statement_id, confidence, status, payload')
        .eq('statement_id', statement.id)
        .eq('status', 'pending')
        .order('id');
      return (data ?? []).map((d) => ({
        ...d,
        payload: d.payload as unknown as DraftPayload,
      })) as Draft[];
    },
    refetchInterval: statementStatus === 'parsing' ? 3000 : false,
  });

  async function getFxRate() {
    const { data } = await supabase
      .from('fx_rates')
      .select('ars_per_usd')
      .eq('source', 'blue')
      .order('date', { ascending: false })
      .limit(1)
      .single();
    return data?.ars_per_usd ?? arsPerUsd ?? null;
  }

  async function acceptDraft(draft: Draft) {
    const rate = await getFxRate();
    const { error } = await supabase.from('transactions').insert({
      household_id: profile.household_id,
      profile_id: profile.id,
      account_id: statement.account_id ?? null,
      statement_id: statement.id,
      type: 'expense',
      amount: draft.payload.amount,
      currency: 'ARS',
      usd_rate_snapshot: rate,
      category_id: draft.payload.category_id ?? null,
      merchant: draft.payload.merchant,
      description: draft.payload.raw_description,
      occurred_on: draft.payload.date,
      scope: 'personal',
      is_shared: false,
      source: 'statement',
    });

    if (error) { toast.error('No se pudo guardar el movimiento'); return false; }

    await supabase
      .from('draft_transactions')
      .update({ status: 'accepted' })
      .eq('id', draft.id);

    return true;
  }

  async function rejectDraft(draftId: string) {
    await supabase.from('draft_transactions').update({ status: 'rejected' }).eq('id', draftId);
    await qc.invalidateQueries({ queryKey: ['drafts', statement.id] });
  }

  async function handleAccept(draft: Draft) {
    // Insert-then-update isn't atomic, so a double tap (or swipe + tap) would
    // insert the transaction twice before the draft flips to 'accepted'.
    // Guard re-entry instead of reordering: flipping the draft first could
    // lose the movement if the insert then fails.
    if (inFlightRef.current.has(draft.id)) return;
    markInFlight([draft.id]);
    try {
      const ok = await acceptDraft(draft);
      if (ok) {
        await qc.invalidateQueries({ queryKey: ['drafts', statement.id] });
        await qc.invalidateQueries({ queryKey: ['transactions'] });
        await qc.invalidateQueries({ queryKey: ['account-tx'] });
        await qc.invalidateQueries({ queryKey: ['spent-by-category'] });
        // An imported expense can push a budget past 80%/100% just like a
        // manual one — best-effort push, dedup handled server-side.
        triggerBudgetAlerts(supabase);
        toast.success('Movimiento aceptado');
      }
    } finally {
      clearInFlight([draft.id]);
    }
  }

  async function handleSaveEdit(updated: Draft, merchantEdited: boolean) {
    setEditingDraft(null);

    // If merchant was edited, upsert merchant_alias so future parses use it
    if (merchantEdited && updated.payload.category_id) {
      await supabase.from('merchant_aliases').upsert(
        {
          household_id: profile.household_id,
          raw_pattern: updated.payload.raw_description.slice(0, 60),
          merchant_clean: updated.payload.merchant,
          category_id: updated.payload.category_id,
        },
        { onConflict: 'household_id,raw_pattern' },
      );
    }

    // Update draft payload
    await supabase
      .from('draft_transactions')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ payload: updated.payload as any })
      .eq('id', updated.id);

    await qc.invalidateQueries({ queryKey: ['drafts', statement.id] });
  }

  async function handleBulkAccept() {
    // Skip drafts already being accepted individually (or by a previous bulk
    // tap still in flight) and anything no longer pending, so a swipe + bulk
    // tap can't insert the same transaction twice.
    const highConf = drafts.filter(
      (d) =>
        d.status === 'pending' &&
        !inFlightRef.current.has(d.id) &&
        (d.payload.confidence ?? d.confidence ?? 0) >= 0.85,
    );
    if (highConf.length === 0) { toast('No hay movimientos de alta confianza'); return; }
    const ids = highConf.map((d) => d.id);
    markInFlight(ids);
    setAccepting(true);
    try {
      const rate = await getFxRate();
      const rows = highConf.map((d) => ({
        household_id: profile.household_id,
        profile_id: profile.id,
        account_id: statement.account_id ?? null,
        statement_id: statement.id,
        type: 'expense' as const,
        amount: d.payload.amount,
        currency: 'ARS',
        usd_rate_snapshot: rate,
        category_id: d.payload.category_id ?? null,
        merchant: d.payload.merchant,
        description: d.payload.raw_description,
        occurred_on: d.payload.date,
        scope: 'personal',
        is_shared: false,
        source: 'statement' as const,
      }));

      const { error } = await supabase.from('transactions').insert(rows);
      if (error) { toast.error('Error al aceptar en masa'); return; }

      await supabase
        .from('draft_transactions')
        .update({ status: 'accepted' })
        .in('id', ids);

      await qc.invalidateQueries({ queryKey: ['drafts', statement.id] });
      await qc.invalidateQueries({ queryKey: ['transactions'] });
      await qc.invalidateQueries({ queryKey: ['account-tx'] });
      await qc.invalidateQueries({ queryKey: ['spent-by-category'] });
      // A month of imported card spend can blow through budgets — check once.
      triggerBudgetAlerts(supabase);
      toast.success(`${highConf.length} movimientos aceptados`);
    } finally {
      clearInFlight(ids);
      setAccepting(false);
    }
  }

  const isParsing = statementStatus === 'parsing';
  const highConfCount = drafts.filter((d) => (d.payload.confidence ?? d.confidence ?? 0) >= 0.85).length;

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F9F5F0' }}>
      {/* Header */}
      <header className="px-5 pt-14 pb-4 flex items-center gap-3">
        <button onClick={() => router.push('/extractos')} className="text-2xl">←</button>
        <div>
          <h1 className="text-xl font-black" style={{ color: '#2D2D2D' }}>Revisar extracto</h1>
          <p className="text-xs" style={{ color: '#6B6459' }}>
            {new Date(statement.created_at).toLocaleDateString('es-AR', { day: 'numeric', month: 'long' })}
          </p>
        </div>
      </header>

      {/* Parsing spinner */}
      {isParsing && (
        <div className="mx-4 mb-4 rounded-3xl p-5 flex items-center gap-3" style={{ background: '#E4F2EA' }}>
          <span className="text-2xl animate-spin">⚙️</span>
          <div>
            <p className="text-sm font-bold" style={{ color: '#5BA886' }}>Analizando con IA…</p>
            <p className="text-xs" style={{ color: '#5BA886' }}>Esto puede tardar un minuto.</p>
          </div>
        </div>
      )}

      {/* Bulk accept banner */}
      {!isParsing && highConfCount > 0 && (
        <div className="mx-4 mb-4 rounded-3xl p-4 flex items-center justify-between gap-3" style={{ background: '#E4F2EA' }}>
          <div>
            <p className="text-sm font-bold" style={{ color: '#5BA886' }}>
              {highConfCount} con alta confianza
            </p>
            <p className="text-xs" style={{ color: '#5BA886' }}>Aceptalos todos de una vez</p>
          </div>
          <button
            onClick={handleBulkAccept}
            disabled={accepting}
            className="px-4 py-2 rounded-2xl text-xs font-black"
            style={{ background: '#7EC8A4', color: '#FFFFFF' }}
          >
            {accepting ? '…' : `Aceptar ${highConfCount}`}
          </button>
        </div>
      )}

      {/* Empty / done states */}
      {!isParsing && !isLoading && drafts.length === 0 && (
        <div className="text-center py-16 px-8">
          <p className="text-5xl mb-4">✅</p>
          <p className="text-base font-bold" style={{ color: '#2D2D2D' }}>
            {statementStatus === 'failed' ? 'Error al analizar el resumen' : 'Todo revisado'}
          </p>
          <p className="text-sm mt-2" style={{ color: '#6B6459' }}>
            {statementStatus === 'failed'
              ? 'Intentá con otro archivo o foto más nítida.'
              : 'Los movimientos aceptados ya aparecen en Movimientos.'}
          </p>
          <button
            onClick={() => router.push('/movimientos')}
            className="mt-5 px-6 py-3 rounded-2xl text-sm font-bold"
            style={{ background: '#7EC8A4', color: '#FFFFFF' }}
          >
            Ver movimientos
          </button>
        </div>
      )}

      {/* Draft cards */}
      {!isParsing && drafts.length > 0 && (
        <div className="px-4">
          <p className="text-xs font-bold mb-3" style={{ color: '#6B6459' }}>
            {drafts.length} movimiento{drafts.length !== 1 ? 's' : ''} para revisar · Deslizá → aceptar · ← rechazar
          </p>
          {drafts.map((draft) => (
            <DraftCard
              key={draft.id}
              draft={draft}
              categories={categories}
              pending={inFlight.has(draft.id)}
              onAccept={() => handleAccept(draft)}
              onReject={() => rejectDraft(draft.id)}
              onEdit={() => setEditingDraft(draft)}
            />
          ))}
        </div>
      )}

      <BottomNav onFab={() => {}} />

      {editingDraft && (
        <EditDraftModal
          draft={editingDraft}
          categories={categories}
          accounts={accounts}
          onSave={handleSaveEdit}
          onClose={() => setEditingDraft(null)}
        />
      )}
    </div>
  );
}
