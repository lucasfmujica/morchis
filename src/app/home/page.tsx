import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import HomeClient from './home-client';

export default async function HomePage() {
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
    .select('id')
    .eq('household_id', profile.household_id)
    .neq('id', user.id)
    .limit(1);

  const partnerProfileId = householdMembers?.[0]?.id;

  return <HomeClient profile={profile as Parameters<typeof HomeClient>[0]['profile']} partnerProfileId={partnerProfileId} />;
}
