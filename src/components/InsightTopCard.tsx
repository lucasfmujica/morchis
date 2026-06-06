'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import Link from 'next/link';

interface Insight {
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'positive' | 'warning';
  kind: string | null;
  created_at: string;
}

const SEVERITY_STYLE: Record<string, { bg: string; color: string; icon: string }> = {
  positive: { bg: '#E4F2EA', color: '#5BA886', icon: '✨' },
  warning:  { bg: '#FFE7E2', color: '#E5604C', icon: '⚠️' },
  info:     { bg: '#F0EDE8', color: '#6B6459', icon: '💡' },
};

export function InsightTopCard({ householdId, profileId }: { householdId: string; profileId: string }) {
  const supabase = createClient();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const { data: insight, isLoading } = useQuery<Insight | null>({
    queryKey: ['top-insight', householdId],
    queryFn: async () => {
      const { data } = await supabase
        .from('insights')
        .select('id, title, body, severity, kind, created_at')
        .eq('household_id', householdId)
        // your own insights + the household's shared ones
        .or(`profile_id.eq.${profileId},profile_id.is.null`)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as Insight | null;
    },
    // Insights are generated periodically (and the refresh button invalidates
    // this key), so they don't need to refetch every few minutes.
    staleTime: 30 * 60 * 1000,
  });

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/generate-insights`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mode: 'full' }),
      });
      await qc.invalidateQueries({ queryKey: ['top-insight', householdId] });
    } finally {
      setRefreshing(false);
    }
  }

  async function markSeen() {
    if (!insight) return;
    await supabase.from('insights').update({ seen: true }).eq('id', insight.id);
  }

  if (isLoading) return null;

  if (!insight) {
    return (
      <div className="mx-4 mb-4 rounded-3xl p-4 flex items-center justify-between" style={{ background: '#F0EDE8' }}>
        <div className="flex items-center gap-3">
          <span className="text-xl">💡</span>
          <p className="text-sm" style={{ color: '#6B6459' }}>Sin insights aún. Tocá para generar.</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="text-xs font-bold px-3 py-1.5 rounded-full"
          style={{ background: '#ECE5DC', color: refreshing ? '#C4B9AE' : '#6B6459' }}
        >
          {refreshing ? '…' : 'Actualizar'}
        </button>
      </div>
    );
  }

  const s = SEVERITY_STYLE[insight.severity] ?? SEVERITY_STYLE.info;

  return (
    <div className="mx-4 mb-4 rounded-3xl p-4" style={{ background: s.bg }}>
      <div className="flex items-start justify-between gap-2">
        <Link href="/analisis" onClick={markSeen} className="flex items-start gap-3 flex-1 min-w-0">
          <span className="text-xl mt-0.5 shrink-0">{s.icon}</span>
          <div className="min-w-0">
            <p className="text-sm font-black leading-tight truncate" style={{ color: s.color }}>{insight.title}</p>
            <p className="text-xs mt-0.5 leading-snug" style={{ color: s.color, opacity: 0.85 }}>{insight.body}</p>
          </div>
        </Link>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="text-[10px] font-bold px-2 py-1 rounded-full shrink-0 mt-0.5"
          style={{ background: `${s.color}22`, color: s.color }}
        >
          {refreshing ? '…' : 'Actualizar'}
        </button>
      </div>
    </div>
  );
}
