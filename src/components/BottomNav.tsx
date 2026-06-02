'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

interface BottomNavProps {
  onFab: (type: 'expense' | 'income') => void;
}

export function BottomNav({ onFab }: BottomNavProps) {
  const path = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

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

  function pick(type: 'expense' | 'income') {
    setMenuOpen(false);
    onFab(type);
  }

  return (
    <>
      {/* Speed-dial backdrop */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-40"
          style={{ background: 'rgba(0,0,0,0.25)' }}
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* Speed-dial actions */}
      {menuOpen && (
        <div
          className="fixed left-0 right-0 z-40 flex flex-col items-center gap-3"
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 88px)' }}
        >
          <button
            onClick={() => pick('income')}
            className="flex items-center gap-2 pl-4 pr-5 py-3 rounded-full text-sm font-black text-white shadow-lg"
            style={{ background: '#7EC8A4' }}
          >
            <span className="text-lg">💰</span> Ingreso
          </button>
          <button
            onClick={() => pick('expense')}
            className="flex items-center gap-2 pl-4 pr-5 py-3 rounded-full text-sm font-black text-white shadow-lg"
            style={{ background: '#FF7F6B' }}
          >
            <span className="text-lg">💸</span> Gasto
          </button>
        </div>
      )}

      <nav
        className="fixed bottom-0 left-0 right-0 flex items-center z-40"
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
            onClick={() => setMenuOpen((v) => !v)}
            className="w-14 h-14 rounded-full text-2xl text-white flex items-center justify-center shadow-lg -mt-5 transition-transform"
            style={{ background: '#FF7F6B', transform: menuOpen ? 'rotate(45deg)' : 'none' }}
            aria-label="Agregar movimiento"
            aria-expanded={menuOpen}
          >
            +
          </button>
        </div>
        {tab('/analisis', 'Análisis', '📊')}
        {tab('/mas', 'Más', '⚙️')}
      </nav>
    </>
  );
}
