'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { BottomNav } from '@/components/BottomNav';
import { AddTransactionSheet } from '@/components/AddTransactionSheet';
import { toast } from 'sonner';
import Link from 'next/link';

interface Insight {
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'positive' | 'warning';
  kind: string | null;
  period: string | null;
  created_at: string;
  seen: boolean;
}

const SEVERITY_STYLE: Record<string, { bg: string; border: string; color: string; icon: string; label: string }> = {
  positive: { bg: '#DDF0E8', border: '#2FA37C', color: '#1F8A68', icon: '✨', label: 'Positivo' },
  warning:  { bg: '#FFE5E0', border: '#FF6F61', color: '#E25749', icon: '⚠️', label: 'Atención' },
  info:     { bg: '#EAF0ED', border: '#B0BAB4', color: '#5B6660', icon: '💡', label: 'Info' },
};

export default function InsightsClient({ householdId, profileId }: { householdId: string; profileId: string }) {
  const supabase = createClient();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  // Brief "✓ Listo" flash on the refresh button after a successful analysis.
  const [justDone, setJustDone] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fabType, setFabType] = useState<'expense' | 'income' | 'transfer'>('expense');

  const { data: insights = [], isLoading } = useQuery<Insight[]>({
    queryKey: ['insights', householdId],
    queryFn: async () => {
      const { data } = await supabase
        .from('insights')
        .select('id, title, body, severity, kind, period, created_at, seen')
        .eq('household_id', householdId)
        // your own insights + the household's shared ones
        .or(`profile_id.eq.${profileId},profile_id.is.null`)
        .order('created_at', { ascending: false })
        .limit(20);
      return (data ?? []) as Insight[];
    },
  });

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error('Iniciá sesión de nuevo para actualizar.');
        return;
      }
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/generate-insights`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mode: 'full' }),
      });
      const data = await res.json().catch(() => null);
      // Generate purchasing power insight in parallel (best-effort)
      fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/purchasing-power-insight`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      }).catch(() => {});
      await qc.invalidateQueries({ queryKey: ['insights', householdId] });
      await qc.invalidateQueries({ queryKey: ['top-insight', householdId] });
      if (!res.ok || !data?.ok) {
        toast.error(
          data && data.generated === 0
            ? 'No se generaron insights (faltan datos del mes o el análisis falló). Probá más tarde.'
            : 'No se pudieron actualizar los insights. Probá de nuevo.',
        );
        return;
      }
      toast.success(`${data.generated} insight${data.generated === 1 ? '' : 's'} actualizado${data.generated === 1 ? '' : 's'} ✓`);
      setJustDone(true);
      setTimeout(() => setJustDone(false), 1600);
    } catch (e) {
      console.error(e);
      toast.error('No se pudieron actualizar los insights. Probá de nuevo.');
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F1F5F3' }}>
      <header className="flex items-center justify-between px-5 pt-14 pb-4">
        <h1 className="text-2xl font-black" style={{ color: '#18211D' }}>Insights ✨</h1>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="text-sm font-black px-4 py-2 rounded-full transition-all"
          style={{
            background: refreshing ? '#E5EBE8' : 'linear-gradient(135deg, #34AD84 0%, #1F8A68 100%)',
            color: refreshing ? '#5B6660' : '#FFFFFF',
            boxShadow: refreshing ? 'none' : 'var(--shadow-glow)',
          }}
        >
          {refreshing ? 'Analizando…' : justDone ? <span key="done" className="inline-block animate-pop">✓ Listo</span> : 'Actualizar'}
        </button>
      </header>

      <div className="px-4 space-y-3">
        {isLoading && (
          <div className="rounded-3xl p-5 animate-pulse" style={{ background: '#E5EBE8', height: 80 }} />
        )}

        {!isLoading && insights.length === 0 && (
          <div className="rounded-3xl p-6 text-center" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
            <p className="text-4xl mb-3">🤔</p>
            <p className="font-bold" style={{ color: '#18211D' }}>Todavía no hay insights</p>
            <p className="text-sm mt-1" style={{ color: '#5B6660' }}>Tocá «Actualizar» para que la IA analice tus gastos.</p>
          </div>
        )}

        {insights.map(insight => {
          const s = SEVERITY_STYLE[insight.severity] ?? SEVERITY_STYLE.info;
          return (
            <Link
              key={insight.id}
              href={`/insights/${insight.id}`}
              className="block rounded-3xl p-5 transition-transform hover:-translate-y-0.5"
              style={{ background: s.bg, border: `1px solid ${s.border}`, boxShadow: 'var(--shadow-card)' }}
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl shrink-0 mt-0.5">{s.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full"
                      style={{ background: `${s.color}22`, color: s.color }}
                    >
                      {s.label}
                    </span>
                    {insight.period && (
                      <span className="text-[10px]" style={{ color: s.color, opacity: 0.6 }}>
                        {insight.period}
                      </span>
                    )}
                    {!insight.seen && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: s.color, color: '#FFFFFF' }}>
                        nuevo
                      </span>
                    )}
                  </div>
                  <p className="font-black text-sm leading-tight" style={{ color: s.color }}>{insight.title}</p>
                  <p className="text-xs mt-1 leading-snug" style={{ color: s.color, opacity: 0.85 }}>{insight.body}</p>
                  <p className="text-[11px] font-bold mt-2" style={{ color: s.color }}>Ver más →</p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      <BottomNav onFab={(type) => { setFabType(type); setSheetOpen(true); }} />
      <AddTransactionSheet
        open={sheetOpen}
        initialType={fabType}
        onClose={() => setSheetOpen(false)}
        householdId={householdId}
        profileId={profileId}
        categories={[]}
        accounts={[]}
      />
    </div>
  );
}
