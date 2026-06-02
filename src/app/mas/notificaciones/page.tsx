import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import NotificacionesClient from './notificaciones-client';

export default async function NotificacionesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth');

  return <NotificacionesClient />;
}
