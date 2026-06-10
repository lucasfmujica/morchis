import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import CategoryDetailClient from './category-detail-client';

export default async function CategoryDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scope?: string }>;
}) {
  const { id } = await params;
  const { scope } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, household_id, nickname, display_name')
    .eq('id', user.id)
    .single();

  if (!profile?.household_id) redirect('/household');

  const { data: category } = await supabase
    .from('categories')
    .select('id, name, icon, color, kind')
    .eq('id', id)
    .eq('household_id', profile.household_id)
    .single();

  if (!category) redirect('/categorias');

  const { data: householdMembers } = await supabase
    .from('profiles')
    .select('id, nickname, display_name')
    .eq('household_id', profile.household_id)
    .neq('id', user.id)
    .limit(1);

  const partner = householdMembers?.[0];
  const partnerProfileId = partner?.id;
  const partnerName = partner?.nickname || partner?.display_name || undefined;
  // Carry the breakdown's scope through so opening a category from "Mío"
  // keeps showing only my movements instead of the whole household.
  const initialScope: 'me' | 'all' | 'partner' =
    scope === 'me' || scope === 'partner' ? scope : 'all';

  return (
    <CategoryDetailClient
      profile={profile as Parameters<typeof CategoryDetailClient>[0]['profile']}
      category={category as Parameters<typeof CategoryDetailClient>[0]['category']}
      partnerProfileId={partnerProfileId}
      partnerName={partnerName}
      initialScope={initialScope}
    />
  );
}
