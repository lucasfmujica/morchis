import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import PinClient from './pin-client';

export default async function PinPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth');

  return <PinClient />;
}
