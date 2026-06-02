'use client';

import Link from 'next/link';
import { useNotifStore } from '@/store/notifStore';

const PREFERENCES = [
  { key: 'insights_weekly' as const, label: 'Resumen semanal de gastos', icon: '📊' },
  { key: 'budget_overspend' as const, label: 'Alerta de presupuesto excedido', icon: '⚠️' },
  { key: 'goal_milestone' as const, label: 'Logros de metas', icon: '🎯' },
  { key: 'partner_activity' as const, label: 'Actividad de tu pareja', icon: '👫' },
];

export default function NotificacionesClient() {
  const store = useNotifStore();

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F9F5F0' }}>
      <header className="px-5 pt-14 pb-4 flex items-center gap-3">
        <Link href="/mas" className="text-2xl">←</Link>
        <h1 className="text-2xl font-black" style={{ color: '#2D2D2D' }}>Notificaciones</h1>
      </header>

      <div className="px-4">
        <div className="rounded-3xl overflow-hidden" style={{ background: '#FFFFFF' }}>
          {PREFERENCES.map((pref, i) => (
            <div
              key={pref.key}
              className="flex items-center gap-3 px-5 py-4"
              style={{ borderTop: i > 0 ? '1px solid #ECE5DC' : 'none' }}
            >
              <span className="text-2xl">{pref.icon}</span>
              <p className="flex-1 font-semibold text-sm" style={{ color: '#2D2D2D' }}>{pref.label}</p>
              <button
                onClick={() => store.setPreference(pref.key, !store[pref.key])}
                className="relative w-12 h-6 rounded-full transition-colors flex-shrink-0"
                style={{ background: store[pref.key] ? '#7EC8A4' : '#ECE5DC' }}
                aria-checked={store[pref.key]}
                role="switch"
              >
                <span
                  className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform"
                  style={{ transform: store[pref.key] ? 'translateX(24px)' : 'translateX(0)' }}
                />
              </button>
            </div>
          ))}
        </div>
        <p className="text-xs mt-4 px-2" style={{ color: '#6B6459' }}>
          Las notificaciones requieren que hayas aceptado los permisos de notificaciones en tu dispositivo.
        </p>
      </div>
    </div>
  );
}
