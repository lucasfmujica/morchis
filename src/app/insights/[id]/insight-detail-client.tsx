'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase';
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
    href: '/ahorro',
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
    href: '/metas',
    cta: 'Ver metas',
  },
  debt: {
    label: 'Deudas',
    explain: 'Plata que te deben o que debés, vinculada a gastos compartidos.',
    href: '/deudas',
    cta: 'Ver deudas',
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
}: {
  insight: Insight;
  isHousehold: boolean;
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
