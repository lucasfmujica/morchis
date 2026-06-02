import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase-server';

export default async function RootPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('household_id, nickname')
    .eq('id', user.id)
    .single();

  if (!profile?.household_id) {
    redirect('/household');
  }

  redirect('/home');
}
