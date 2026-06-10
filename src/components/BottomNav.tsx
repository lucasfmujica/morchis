'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase';

interface BottomNavProps {
  onFab: (type: 'expense' | 'income' | 'transfer') => void;
}

// All the screens that used to live behind the "Más" page, surfaced directly in
// a slide-up menu so they're one tap away. Invite + PIN are de-emphasised at the
// bottom (rarely used).
const MENU = [
  { href: '/insights', icon: '✨', label: 'Insights' },
  { href: '/cuentas', icon: '🏦', label: 'Cuentas' },
  { href: '/categorias', icon: '🏷️', label: 'Categorías' },
  { href: '/presupuestos', icon: '📊', label: 'Presupuestos' },
  { href: '/ahorro', icon: '🐷', label: 'Ahorro' },
  { href: '/metas', icon: '🎯', label: 'Metas' },
  { href: '/reglas', icon: '📅', label: 'Fijos' },
  { href: '/deudas', icon: '🤝', label: 'Deudas' },
  { href: '/pareja', icon: '👫', label: 'Pareja' },
  { href: '/ticket', icon: '🧾', label: 'Escanear ticket' },
  { href: '/extractos', icon: '💳', label: 'Extractos' },
  { href: '/simulador', icon: '🔮', label: 'Simulador' },
  { href: '/mas/notificaciones', icon: '🔔', label: 'Notificaciones' },
];
const SECONDARY = [
  { href: '/mas', icon: '💌', label: 'Invitar a mi pareja' },
  { href: '/mas/pin', icon: '🔐', label: 'Bloqueo con PIN' },
];

export function BottomNav({ onFab }: BottomNavProps) {
  const path = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  function tab(href: string, label: string, icon: string) {
    const active = path === href || path.startsWith(href + '/');
    return (
      <Link
        href={href}
        className="flex flex-col items-center gap-0.5 flex-1 py-2"
        style={{ color: active ? '#7EC8A4' : '#6B6459' }}
      >
        <span className="text-2xl">{icon}</span>
        <span className="text-[10px] font-semibold">{label}</span>
      </Link>
    );
  }

  function pick(type: 'expense' | 'income' | 'transfer') {
    setMenuOpen(false);
    onFab(type);
  }

  async function logout() {
    setMoreOpen(false);
    await supabase.auth.signOut();
    router.push('/auth');
  }

  const moreActive = path === '/mas' || path.startsWith('/mas');

  return (
    <>
      {/* Floating "Preguntale a Morchi" button — hidden on the chat itself. */}
      {!path.startsWith('/preguntale') && (
        <Link
          href="/preguntale"
          aria-label="Preguntale a Morchi"
          className="fixed z-40 flex items-center justify-center rounded-full shadow-lg"
          style={{
            right: 16,
            bottom: 'calc(env(safe-area-inset-bottom) + 76px)',
            width: 52, height: 52,
            background: '#7EC8A4',
            fontSize: 24,
          }}
        >
          💬
        </Link>
      )}

      {/* Speed-dial backdrop */}
      {menuOpen && (
        <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.25)' }} onClick={() => setMenuOpen(false)} />
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
          <button
            onClick={() => pick('transfer')}
            className="flex items-center gap-2 pl-4 pr-5 py-3 rounded-full text-sm font-black text-white shadow-lg"
            style={{ background: '#5B8DEF' }}
          >
            <span className="text-lg">🔄</span> Transferencia
          </button>
        </div>
      )}

      {/* "Más" slide-up menu */}
      {moreOpen && (
        <div className="fixed inset-0 z-50 flex items-end" style={{ background: 'rgba(45,45,45,0.4)' }} onClick={() => setMoreOpen(false)}>
          <div
            className="w-full rounded-t-3xl p-5 max-h-[80vh] overflow-y-auto"
            style={{ background: '#FFFFFF', paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: '#ECE5DC' }} />
            <h2 className="text-lg font-black mb-4 px-1" style={{ color: '#2D2D2D' }}>Menú</h2>

            <div className="grid grid-cols-3 gap-2">
              {MENU.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className="flex flex-col items-center justify-center gap-1 rounded-2xl py-4 px-1 text-center"
                  style={{ background: '#F9F5F0' }}
                >
                  <span className="text-2xl">{item.icon}</span>
                  <span className="text-[11px] font-bold leading-tight" style={{ color: '#2D2D2D' }}>{item.label}</span>
                </Link>
              ))}
            </div>

            <div className="mt-4 pt-3" style={{ borderTop: '1px solid #ECE5DC' }}>
              {SECONDARY.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className="flex items-center gap-3 px-2 py-3 text-sm"
                  style={{ color: '#6B6459' }}
                >
                  <span className="text-lg">{item.icon}</span>
                  <span className="font-semibold">{item.label}</span>
                </Link>
              ))}
              <button
                onClick={logout}
                className="flex items-center gap-3 px-2 py-3 text-sm w-full text-left"
                style={{ color: '#6B6459' }}
              >
                <span className="text-lg">🚪</span>
                <span className="font-semibold">Cerrar sesión</span>
              </button>
            </div>
          </div>
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
        <button
          onClick={() => setMoreOpen(true)}
          className="flex flex-col items-center gap-0.5 flex-1 py-2"
          style={{ color: moreActive ? '#7EC8A4' : '#6B6459' }}
          aria-label="Menú"
          aria-expanded={moreOpen}
        >
          <span className="text-2xl">☰</span>
          <span className="text-[10px] font-semibold">Más</span>
        </button>
      </nav>
    </>
  );
}
