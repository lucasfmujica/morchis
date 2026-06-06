import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import InsightDetailClient from './insight-detail-client';

export default async function InsightDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, household_id, nickname, display_name')
    .eq('id', user.id)
    .single();

  if (!profile?.household_id) redirect('/household');

  // Only the user's own insights + the household's shared ones are reachable.
  const { data: insight } = await supabase
    .from('insights')
    .select('id, title, body, severity, kind, period, created_at, profile_id')
    .eq('id', id)
    .eq('household_id', profile.household_id)
    .or(`profile_id.eq.${profile.id},profile_id.is.null`)
    .maybeSingle();

  if (!insight) redirect('/insights');

  return (
    <InsightDetailClient
      insight={insight as Parameters<typeof InsightDetailClient>[0]['insight']}
      isHousehold={insight.profile_id == null}
    />
  );
}
