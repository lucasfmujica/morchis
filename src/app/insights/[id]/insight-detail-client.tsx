'use client';

import { useEffect, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { useFx } from '@/hooks/useFx';
import { matchInsightCategoryId } from '@/lib/insightLink';
import { myShareArs, type SplitRow } from '@/lib/budgets';
import { monthKey, toLocalISO, todayISO } from '@/lib/date';
import { formatARS } from '@/lib/format';
import Link from 'next/link';

interface Insight {
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'positive' | 'warning';
  kind: string | null;
  period: string | null;
  created_at: string;
}

const SEVERITY_STYLE: Record<string, { bg: string; border: string; color: string; icon: string; label: string }> = {
  positive: { bg: '#E4F2EA', border: '#7EC8A4', color: '#5BA886', icon: '✨', label: 'Buena noticia' },
  warning:  { bg: '#FFE7E2', border: '#FF7F6B', color: '#E5604C', icon: '⚠️', label: 'Atención' },
  info:     { bg: '#F0EDE8', border: '#C4B9AE', color: '#6B6459', icon: '💡', label: 'Para tener en cuenta' },
};

// What each insight kind means + where to go to act on it. Keeps the detail
// screen useful: the body is short, so we explain the type and offer a concrete
// next step (the relevant section of the app).
const KIND_META: Record<string, { label: string; explain: string; href: string; cta: string }> = {
  saving: {
    label: 'Tasa de ahorro',
    explain: 'Compara cuánto entró contra cuánto se gastó este mes. Subir este porcentaje es la forma más directa de ahorrar más.',
    href: '/analisis',
    cta: 'Ver mi ahorro',
  },
  spike: {
    label: 'Pico de gasto',
    explain: 'Una categoría gastó bastante más que su promedio de los últimos meses. Vale la pena revisar qué lo empujó.',
    href: '/analisis',
    cta: 'Ver análisis',
  },
  anthill: {
    label: 'Gastos hormiga',
    explain: 'Muchas compras chicas que, sumadas, pesan más de lo que parece. Detectarlas ayuda a recortar sin esfuerzo.',
    href: '/movimientos',
    cta: 'Ver movimientos',
  },
  duplicate: {
    label: 'Posible cargo duplicado',
    explain: 'Un mismo comercio aparece con el mismo monto más de una vez el mismo día. Conviene chequear que no sea un cobro repetido.',
    href: '/movimientos',
    cta: 'Revisar movimientos',
  },
  subscription: {
    label: 'Suscripciones y gastos fijos',
    explain: 'Lo que se paga todos los meses sí o sí. Cancelar lo que no usás baja el gasto fijo de forma permanente.',
    href: '/analisis',
    cta: 'Ver suscripciones',
  },
  budget: {
    label: 'Presupuesto',
    explain: 'Cómo viene una categoría contra el límite que le pusiste. Ajustar el ritmo a tiempo evita pasarte.',
    href: '/presupuestos',
    cta: 'Ver presupuestos',
  },
  goal: {
    label: 'Meta de ahorro',
    explain: 'Cuánto falta y cuánto apartar por mes para llegar a tu objetivo en fecha.',
    href: '/presupuestos',
    cta: 'Ver metas',
  },
  debt: {
    label: 'Deudas',
    explain: 'Plata que te deben o que debés, vinculada a gastos compartidos.',
    href: '/deudas',
    cta: 'Ver deudas',
  },
  monthly_close: {
    label: 'Cierre de mes',
    explain: 'Resumen del mes cerrado: gastos, ahorro y presupuestos del mes que terminó, comparado con el anterior.',
    href: '/analisis',
    cta: 'Ver análisis',
  },
  summary: {
    label: 'Resumen del mes',
    explain: 'Una foto general de en qué se fue la plata este mes.',
    href: '/analisis',
    cta: 'Ver análisis',
  },
};

function periodLabel(period: string | null): string | null {
  if (!period || !/^\d{4}-\d{2}$/.test(period)) return null;
  const [y, m] = period.split('-').map(Number);
  const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${months[m - 1]} de ${y}`;
}

export default function InsightDetailClient({
  insight,
  isHousehold,
  householdId,
  profileId,
}: {
  insight: Insight;
  isHousehold: boolean;
  householdId: string;
  profileId: string;
}) {
  const supabase = createClient();

  // Opening the detail counts as having seen the insight.
  useEffect(() => {
    supabase.from('insights').update({ seen: true }).eq('id', insight.id).then(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insight.id]);

  const s = SEVERITY_STYLE[insight.severity] ?? SEVERITY_STYLE.info;
  const kind = (insight.kind && KIND_META[insight.kind]) || KIND_META.summary;
  const period = periodLabel(insight.period);
  const created = new Date(insight.created_at).toLocaleDateString('es-AR', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F9F5F0' }}>
      <header className="px-5 pt-14 pb-4 flex items-center gap-3">
        <Link href="/insights" className="text-2xl">←</Link>
        <h1 className="text-2xl font-black" style={{ color: '#2D2D2D' }}>Insight ✨</h1>
      </header>

      <div className="px-4 flex flex-col gap-4">
        {/* The insight itself */}
        <div className="rounded-3xl p-6" style={{ background: s.bg, border: `1px solid ${s.border}` }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-3xl">{s.icon}</span>
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: `${s.color}22`, color: s.color }}>
              {s.label}
            </span>
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: '#FFFFFF99', color: s.color }}>
              {isHousehold ? '🏠 Hogar' : '👤 Personal'}
            </span>
          </div>
          <p className="text-xl font-black leading-tight mb-2" style={{ color: s.color }}>{insight.title}</p>
          <p className="text-sm leading-relaxed" style={{ color: s.color, opacity: 0.9 }}>{insight.body}</p>
        </div>

        {/* If the insight is about a category, show its spend so far + how the
            month-end projection is built — the concrete data behind the card. */}
        <CategoryInsightSection
          insightText={`${insight.title} ${insight.body}`}
          householdId={householdId}
          scopeProfileId={isHousehold ? undefined : profileId}
        />

        {/* What this kind of insight means */}
        <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
          <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#6B6459' }}>
            ¿Qué es esto?
          </p>
          <p className="text-sm font-black mb-1" style={{ color: '#2D2D2D' }}>{kind.label}</p>
          <p className="text-sm leading-relaxed" style={{ color: '#6B6459' }}>{kind.explain}</p>
        </div>

        {/* Context: who / when */}
        <div className="rounded-3xl p-5 flex flex-col gap-2.5" style={{ background: '#FFFFFF' }}>
          {period && (
            <div className="flex items-center justify-between">
              <span className="text-sm" style={{ color: '#6B6459' }}>Período analizado</span>
              <span className="text-sm font-bold capitalize" style={{ color: '#2D2D2D' }}>{period}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-sm" style={{ color: '#6B6459' }}>Generado el</span>
            <span className="text-sm font-bold" style={{ color: '#2D2D2D' }}>{created}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm" style={{ color: '#6B6459' }}>Alcance</span>
            <span className="text-sm font-bold" style={{ color: '#2D2D2D' }}>
              {isHousehold ? 'Gastos del hogar' : 'Tus gastos personales'}
            </span>
          </div>
        </div>

        {/* Concrete next step */}
        <Link
          href={kind.href}
          className="rounded-3xl p-4 flex items-center justify-between"
          style={{ background: '#7EC8A4' }}
        >
          <span className="text-sm font-black text-white">{kind.cta}</span>
          <span className="text-white text-lg">→</span>
        </Link>

        <Link href="/insights" className="text-xs font-bold text-center pt-1" style={{ color: '#5BA886' }}>
          Ver todos los insights
        </Link>
      </div>
    </div>
  );
}

type CatTxn = {
  id: string;
  amount: number;
  currency: string;
  occurred_on: string;
  merchant: string | null;
  profile_id: string;
  is_shared: boolean;
  scope: string;
  category_id: string | null;
  splits: SplitRow[] | null;
};

/**
 * When an insight names a category, this surfaces the data behind it: how much
 * went to that category so far this month, a few recent movements, and a
 * month-end projection with the breakdown of how it's reached (gastado · ritmo ·
 * días restantes). Renders nothing when no category matches the insight text.
 */
function CategoryInsightSection({
  insightText,
  householdId,
  scopeProfileId,
}: {
  insightText: string;
  householdId: string;
  scopeProfileId: string | undefined;
}) {
  const supabase = createClient();
  const { arsPerUsd } = useFx();

  const { data: categories = [] } = useQuery<{ id: string; name: string; icon: string; color: string | null; kind: string }[]>({
    queryKey: ['categories', householdId],
    queryFn: async () => {
      const { data } = await supabase
        .from('categories')
        .select('id, name, icon, kind, color')
        .eq('household_id', householdId)
        .order('name');
      return data ?? [];
    },
    staleTime: 30 * 60 * 1000,
  });

  const matchedCat = useMemo(() => {
    const id = matchInsightCategoryId(insightText, categories);
    return id ? categories.find((c) => c.id === id) ?? null : null;
  }, [insightText, categories]);

  const { monthStart, monthEnd } = useMemo(() => {
    const t = new Date();
    return { monthStart: monthKey(t) + '-01', monthEnd: toLocalISO(new Date(t.getFullYear(), t.getMonth() + 1, 0)) };
  }, []);

  const { data: txns = [] } = useQuery<CatTxn[]>({
    queryKey: ['insight-category-tx', matchedCat?.id, monthStart],
    enabled: !!matchedCat && matchedCat.kind === 'expense',
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('id, amount, currency, occurred_on, merchant, profile_id, is_shared, scope, category_id, splits(payer_profile_id, ower_profile_id, amount)')
        .eq('household_id', householdId)
        .eq('category_id', matchedCat!.id)
        .eq('type', 'expense')
        .gte('occurred_on', monthStart)
        .lte('occurred_on', monthEnd)
        .order('occurred_on', { ascending: false });
      return (data ?? []) as CatTxn[];
    },
  });

  const { data: budget = 0 } = useQuery<number>({
    queryKey: ['category-budget', matchedCat?.id, arsPerUsd],
    enabled: !!matchedCat && matchedCat.kind === 'expense',
    queryFn: async () => {
      const { data } = await supabase
        .from('budgets')
        .select('amount, currency')
        .eq('household_id', householdId)
        .eq('category_id', matchedCat!.id)
        .eq('active', true);
      return (data ?? []).reduce(
        (s, b) => s + (b.currency === 'USD' && arsPerUsd > 0 ? Math.round(b.amount * arsPerUsd) : b.amount),
        0,
      );
    },
  });

  const toArs = useCallback(
    (amount: number, currency: string) => (currency === 'USD' && arsPerUsd > 0 ? Math.round(amount * arsPerUsd) : amount),
    [arsPerUsd],
  );

  // Each movement's share for the active scope, in ARS — a shared bill counts
  // only the viewer's part (mirrors Análisis / Presupuestos), so totals and the
  // listed amounts agree.
  const shareArs = useCallback(
    (t: CatTxn): number => {
      if (!scopeProfileId) return toArs(t.amount, t.currency); // household scope
      if (!t.is_shared) return t.profile_id === scopeProfileId ? toArs(t.amount, t.currency) : 0;
      return myShareArs(t, scopeProfileId, arsPerUsd);
    },
    [toArs, arsPerUsd, scopeProfileId],
  );

  const proj = useMemo(() => {
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth = now.getDate();
    const daysElapsed = Math.max(1, dayOfMonth);
    const daysRemaining = daysInMonth - dayOfMonth;
    const today = todayISO();
    const upToToday = txns.filter((t) => t.occurred_on <= today);
    const spentSoFar = upToToday.reduce((s, t) => s + shareArs(t), 0);
    const count = upToToday.filter((t) => shareArs(t) > 0).length;
    const dailyRate = Math.round(spentSoFar / daysElapsed);
    const projected = spentSoFar + Math.round(dailyRate * daysRemaining);
    const recent = upToToday.filter((t) => shareArs(t) > 0).slice(0, 5);
    return { daysElapsed, daysRemaining, spentSoFar, count, dailyRate, projected, recent };
  }, [txns, shareArs]);

  if (!matchedCat || matchedCat.kind !== 'expense') return null;
  if (proj.spentSoFar <= 0 && budget <= 0) return null;

  const accent = matchedCat.color || '#FF7F6B';
  const overBudget = budget > 0 && proj.projected > budget;
  const projPct = budget > 0 ? proj.projected / budget : 0;
  const projColor = overBudget ? '#E5604C' : accent;

  function fmtDate(d: string) {
    return new Date(d + 'T00:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
  }

  return (
    <>
      {/* Spend so far in this category */}
      <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#6B6459' }}>
            {matchedCat.icon} {matchedCat.name} · este mes
          </p>
          <span className="text-[11px]" style={{ color: '#6B6459' }}>
            {proj.count} {proj.count === 1 ? 'movimiento' : 'movimientos'}
          </span>
        </div>
        <p className="text-3xl font-black leading-none" style={{ color: accent, fontVariantNumeric: 'tabular-nums' }}>
          {formatARS(proj.spentSoFar)}
        </p>

        {proj.recent.length > 0 && (
          <div className="mt-4 flex flex-col gap-2.5">
            {proj.recent.map((t) => (
              <div key={t.id} className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: '#2D2D2D' }}>{t.merchant || matchedCat.name}</p>
                  <p className="text-[11px]" style={{ color: '#6B6459' }}>{fmtDate(t.occurred_on)}{t.is_shared ? ' · compartido' : ''}</p>
                </div>
                <p className="text-sm font-black" style={{ color: '#FF7F6B' }}>-{formatARS(shareArs(t))}</p>
              </div>
            ))}
          </div>
        )}

        <Link href="/analisis/categorias" className="block text-xs font-bold mt-3" style={{ color: '#5BA886' }}>
          Ver todo el detalle de {matchedCat.name} →
        </Link>
      </div>

      {/* Month-end projection for this category — "si seguís así" */}
      <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#6B6459' }}>
            Si seguís así, fin de mes
          </p>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${projColor}22`, color: projColor }}>
            estimado
          </span>
        </div>

        <p className="text-[clamp(1.5rem,8vw,2rem)] font-black leading-none mb-1" style={{ color: projColor, fontVariantNumeric: 'tabular-nums' }}>
          {formatARS(proj.projected)}
        </p>
        {budget > 0 && (
          <p className="text-xs" style={{ color: projColor, opacity: 0.75 }}>
            {Math.round(projPct * 100)}% del presupuesto ({formatARS(budget)})
          </p>
        )}

        {/* How we got there: gastado · ritmo · días restantes */}
        <div className="grid grid-cols-3 gap-2 mt-3 pt-3" style={{ borderTop: `1px solid ${projColor}33` }}>
          <div>
            <p className="text-[11px]" style={{ color: projColor, opacity: 0.75 }}>Gastado</p>
            <p className="text-sm font-bold" style={{ color: projColor }}>{formatARS(proj.spentSoFar)}</p>
          </div>
          <div>
            <p className="text-[11px]" style={{ color: projColor, opacity: 0.75 }}>Ritmo</p>
            <p className="text-sm font-bold" style={{ color: projColor }}>~{formatARS(proj.dailyRate)}/día</p>
          </div>
          <div>
            <p className="text-[11px]" style={{ color: projColor, opacity: 0.75 }}>Quedan</p>
            <p className="text-sm font-bold" style={{ color: projColor }}>{proj.daysRemaining} días</p>
          </div>
        </div>

        {budget > 0 && (
          <div className="mt-3 h-2 rounded-full overflow-hidden" style={{ background: '#ECE5DC' }}>
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(projPct * 100, 100)}%`, background: projColor }} />
          </div>
        )}

        <p className="text-[11px] mt-3 leading-relaxed" style={{ color: projColor, opacity: 0.75 }}>
          Vas {formatARS(proj.spentSoFar)} en {proj.daysElapsed} {proj.daysElapsed === 1 ? 'día' : 'días'} (~{formatARS(proj.dailyRate)}/día).
          {proj.daysRemaining > 0
            ? ` Si seguís a este ritmo, cerrás el mes en ~${formatARS(proj.projected)}.`
            : ' Es el último día del mes.'}
          {overBudget ? ` Te pasarías ${formatARS(proj.projected - budget)} del presupuesto.` : ''}
        </p>
      </div>
    </>
  );
}
