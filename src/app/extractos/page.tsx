import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Database } from '@/lib/database.types';
import ExtractosClient from './extractos-client';

export default async function ExtractosPage() {
  const cookieStore = await cookies();
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } },
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, household_id, nickname, display_name')
    .eq('id', user.id)
    .single();

  if (!profile?.household_id) redirect('/household');

  const { data: accounts = [] } = await supabase
    .from('accounts')
    .select('id, name, type, owner_profile_id')
    .eq('household_id', profile.household_id)
    .eq('archived', false)
    .order('name');

  return (
    <ExtractosClient
      profile={profile as { id: string; household_id: string; nickname: string | null; display_name: string | null }}
      accounts={accounts ?? []}
    />
  );
}
