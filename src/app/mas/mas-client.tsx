'use client';

import Link from 'next/link';
import { createClient } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { BottomNav } from '@/components/BottomNav';
import { AddTransactionSheet } from '@/components/AddTransactionSheet';
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

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase.from('categories').select('id, name, icon, kind').eq('household_id', profile.household_id).order('name');
      return data ?? [];
    },
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase.from('accounts').select('id, name, type').eq('household_id', profile.household_id).eq('archived', false).order('name');
      return data ?? [];
    },
  });

  async function logout() {
    await supabase.auth.signOut();
    router.push('/auth');
  }

  const menuItems = [
    { href: '/cuentas', icon: '🏦', label: 'Cuentas' },
    { href: '/categorias', icon: '🏷️', label: 'Categorías' },
  ];

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F9F5F0' }}>
      <header className="px-5 pt-14 pb-4">
        <h1 className="text-2xl font-black" style={{ color: '#2D2D2D' }}>Más</h1>
      </header>

      <div className="px-4 flex flex-col gap-3">
        <div className="rounded-3xl overflow-hidden" style={{ background: '#FFFFFF' }}>
          {menuItems.map((item, i) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 px-5 py-4"
              style={{ borderTop: i > 0 ? '1px solid #ECE5DC' : 'none' }}
            >
              <span className="text-2xl">{item.icon}</span>
              <p className="flex-1 font-semibold" style={{ color: '#2D2D2D' }}>{item.label}</p>
              <span style={{ color: '#8A8276' }}>→</span>
            </Link>
          ))}
        </div>

        <button
          onClick={logout}
          className="w-full py-4 rounded-3xl text-sm font-bold border"
          style={{ borderColor: '#ECE5DC', color: '#8A8276', background: '#FFFFFF' }}
        >
          Cerrar sesión
        </button>
      </div>

      <BottomNav onFab={() => setSheetOpen(true)} />
      <AddTransactionSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        householdId={profile.household_id}
        profileId={profile.id}
        categories={categories}
        accounts={accounts}
      />
    </div>
  );
}
