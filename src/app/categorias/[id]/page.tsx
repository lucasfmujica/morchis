import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import CategoryDetailClient from './category-detail-client';

export default async function CategoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

  return (
    <CategoryDetailClient
      profile={profile as Parameters<typeof CategoryDetailClient>[0]['profile']}
      category={category as Parameters<typeof CategoryDetailClient>[0]['category']}
    />
  );
}
