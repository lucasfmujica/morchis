import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import AhorroClient from './ahorro-client';

export default async function AhorroPage() {
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
  const partnerProfileId = partner?.id;
  const partnerName = partner?.nickname || partner?.display_name || undefined;

  return (
    <AhorroClient
      profile={profile as Parameters<typeof AhorroClient>[0]['profile']}
      partnerProfileId={partnerProfileId}
      partnerName={partnerName}
    />
  );
}
