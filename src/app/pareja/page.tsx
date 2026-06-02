import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import ParejaClient from './pareja-client';

export default async function ParejaPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, household_id, nickname, display_name')
    .eq('id', user.id)
    .single();

  if (!profile?.household_id) redirect('/household');

  const { data: householdMembers } = await supabase
    .from('profiles')
    .select('id, nickname, display_name')
    .eq('household_id', profile.household_id)
    .neq('id', user.id)
    .limit(1);

  const partner = householdMembers?.[0];

  return (
    <ParejaClient
      profile={profile as { id: string; household_id: string; nickname: string | null; display_name: string | null }}
      partner={partner ? {
        id: partner.id,
        name: partner.nickname || partner.display_name || 'Pareja',
      } : undefined}
    />
  );
}
