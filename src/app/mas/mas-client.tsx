'use client';

import Link from 'next/link';
import { createClient } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { BottomNav } from '@/components/BottomNav';
import { AddTransactionSheet } from '@/components/AddTransactionSheet';
import { InvitePartnerModal } from '@/components/InvitePartnerModal';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

interface Profile {
  id: string;
  household_id: string;
  nickname: string | null;
  display_name: string | null;
}

export default function MasClient({ profile }: { profile: Profile }) {
  const supabase = createClient();
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fabType, setFabType] = useState<'expense' | 'income' | 'transfer'>('expense');
  const [inviteOpen, setInviteOpen] = useState(false);

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase.from('categories').select('id, name, icon, kind, color').eq('household_id', profile.household_id).order('name');
      return data ?? [];
    },
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase.from('accounts').select('id, name, type, owner_profile_id').eq('household_id', profile.household_id).eq('archived', false).order('name');
      return data ?? [];
    },
  });

  async function logout() {
    await supabase.auth.signOut();
    router.push('/auth');
  }

  const sections = [
    { title: 'Cuentas', items: [{ href: '/cuentas', icon: '🏦', label: 'Cuentas' }] },
    { title: 'Pareja & deudas', items: [
      { href: '/pareja', icon: '👫', label: 'Vista de pareja' },
      { href: '/deudas', icon: '🤝', label: 'Deudas' },
    ] },
    { title: 'Planificación', items: [
      { href: '/reglas', icon: '📅', label: 'Ingresos y gastos fijos' },
      { href: '/simulador', icon: '🔮', label: 'Simulador de compras' },
    ] },
    { title: 'Capturar', items: [
      { href: '/ticket', icon: '🧾', label: 'Escanear ticket' },
      { href: '/super', icon: '🛒', label: 'Compras de súper' },
      { href: '/cafes', icon: '☕', label: 'Cafés' },
      { href: '/extractos', icon: '🧾', label: 'Extractos de tarjeta' },
    ] },
    { title: 'Ajustes', items: [
      { href: '/mas/notificaciones', icon: '🔔', label: 'Notificaciones' },
    ] },
  ];

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F1F5F3' }}>
      <header className="px-5 pt-14 pb-4">
        <h1 className="text-2xl font-black" style={{ color: '#18211D' }}>Más</h1>
      </header>

      <div className="px-4 flex flex-col gap-4">
        {sections.map((section) => (
          <div key={section.title}>
            <p className="text-xs font-bold uppercase tracking-wide mb-2 px-1" style={{ color: '#5B6660' }}>{section.title}</p>
            <div className="rounded-3xl overflow-hidden" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
              {section.items.map((item, i) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-[#F4F8F6] active:bg-[#EEF3F1]"
                  style={i > 0 ? { borderTop: '1px solid #E5EBE8' } : undefined}
                >
                  <span className="text-2xl">{item.icon}</span>
                  <p className="flex-1 font-semibold" style={{ color: '#18211D' }}>{item.label}</p>
                  <span style={{ color: '#5B6660' }}>→</span>
                </Link>
              ))}
            </div>
          </div>
        ))}

        {/* De-emphasised: rarely used. */}
        <div className="rounded-3xl overflow-hidden" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
          <button
            onClick={() => setInviteOpen(true)}
            className="w-full flex items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-[#F4F8F6] active:bg-[#EEF3F1]"
          >
            <span className="text-xl">💌</span>
            <p className="flex-1 text-sm font-semibold" style={{ color: '#5B6660' }}>Invitar a mi pareja</p>
            <span style={{ color: '#5B6660' }}>→</span>
          </button>
          <Link
            href="/mas/pin"
            className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-[#F4F8F6] active:bg-[#EEF3F1]"
            style={{ borderTop: '1px solid #E5EBE8' }}
          >
            <span className="text-xl">🔐</span>
            <p className="flex-1 text-sm font-semibold" style={{ color: '#5B6660' }}>Bloqueo con PIN</p>
            <span style={{ color: '#5B6660' }}>→</span>
          </Link>
        </div>

        <button
          onClick={logout}
          className="w-full py-4 rounded-3xl text-sm font-bold border transition-colors hover:bg-[#F4F8F6] active:bg-[#EEF3F1]"
          style={{ borderColor: '#E5EBE8', color: '#5B6660', background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}
        >
          Cerrar sesión
        </button>
      </div>

      <BottomNav onFab={(type) => { setFabType(type); setSheetOpen(true); }} />
      <AddTransactionSheet
        open={sheetOpen}
        initialType={fabType}
        onClose={() => setSheetOpen(false)}
        householdId={profile.household_id}
        profileId={profile.id}
        categories={categories}
        accounts={accounts}
      />
      <InvitePartnerModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  );
}
