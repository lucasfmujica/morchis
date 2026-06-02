import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import ReglasClient from './reglas-client';

export default async function ReglasPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, household_id, nickname, display_name')
    .eq('id', user.id)
    .single();

  if (!profile?.household_id) redirect('/household');

  return <ReglasClient profile={profile as Parameters<typeof ReglasClient>[0]['profile']} />;
}
