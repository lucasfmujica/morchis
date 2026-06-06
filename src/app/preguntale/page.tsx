import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import PreguntaleClient from './preguntale-client';

export default async function PreguntalePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth');
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, household_id')
    .eq('id', user.id)
    .single();
  if (!profile?.household_id) redirect('/household');
  return <PreguntaleClient householdId={profile.household_id} profileId={profile.id} />;
}
