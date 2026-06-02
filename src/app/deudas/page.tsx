import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import DeudasClient from './deudas-client';

export default async function DeudasPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, household_id, nickname, display_name')
    .eq('id', user.id)
    .single();

  if (!profile?.household_id) redirect('/household');

  return <DeudasClient profile={profile as Parameters<typeof DeudasClient>[0]['profile']} />;
}
