'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface BottomNavProps {
  onFab: () => void;
}

export function BottomNav({ onFab }: BottomNavProps) {
  const path = usePathname();

  function tab(href: string, label: string, icon: string) {
    const active = path === href || path.startsWith(href + '/');
    return (
      <Link
        href={href}
        className="flex flex-col items-center gap-0.5 flex-1 py-2"
        style={{ color: active ? '#7EC8A4' : '#8A8276' }}
      >
        <span className="text-2xl">{icon}</span>
        <span className="text-[10px] font-semibold">{label}</span>
      </Link>
    );
  }

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 flex items-center"
      style={{
        background: '#FFFFFF',
        borderTop: '1px solid #ECE5DC',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {tab('/home', 'Inicio', '🏠')}
      {tab('/movimientos', 'Movimientos', '📋')}
      <div className="flex-1 flex justify-center">
        <button
          onClick={onFab}
          className="w-14 h-14 rounded-full text-2xl text-white flex items-center justify-center shadow-lg -mt-5"
          style={{ background: '#FF7F6B' }}
          aria-label="Agregar movimiento"
        >
          +
        </button>
      </div>
      {tab('/metas', 'Metas', '🎯')}
      {tab('/mas', 'Más', '⚙️')}
    </nav>
  );
}
