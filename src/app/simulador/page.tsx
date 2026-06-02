import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import SimuladorClient from './simulador-client';

export default async function SimuladorPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth');
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, household_id, nickname, display_name')
    .eq('id', user.id)
    .single();
  if (!profile?.household_id) redirect('/household');
  return <SimuladorClient profile={profile as Parameters<typeof SimuladorClient>[0]['profile']} />;
}
