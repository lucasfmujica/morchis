import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import CuentasClient from './cuentas-client';

export default async function CuentasPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, household_id, nickname, display_name')
    .eq('id', user.id)
    .single();

  if (!profile?.household_id) redirect('/household');

  return <CuentasClient profile={profile as Parameters<typeof CuentasClient>[0]['profile']} />;
}
