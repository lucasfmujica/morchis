import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import type { Database } from '@/lib/database.types';
import ReviewClient from './review-client';

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

  const { data: statement } = await supabase
    .from('statements')
    .select('id, status, created_at, account_id')
    .eq('id', id)
    .eq('household_id', profile.household_id)
    .single();

  if (!statement) notFound();

  const { data: categories = [] } = await supabase
    .from('categories')
    .select('id, name, icon, kind')
    .eq('household_id', profile.household_id)
    .order('name');

  const { data: accounts = [] } = await supabase
    .from('accounts')
    .select('id, name, type')
    .eq('household_id', profile.household_id)
    .eq('archived', false)
    .order('name');

  return (
    <ReviewClient
      profile={profile as { id: string; household_id: string; nickname: string | null; display_name: string | null }}
      statement={statement}
      categories={categories ?? []}
      accounts={accounts ?? []}
    />
  );
}
