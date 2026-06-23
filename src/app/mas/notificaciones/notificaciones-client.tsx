'use client';

import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';

// These keys mirror what the server-side push senders check before sending:
// a key that's absent (or true) means enabled; an explicit false means muted.
const PREFERENCES = [
  {
    key: 'budget_alerts',
    label: 'Alertas de presupuesto',
    description: 'Aviso cuando un presupuesto pasa el 80% o se excede',
    icon: '⚠️',
  },
  {
    key: 'insights',
    label: 'Insights del coach',
    description: 'Resumen semanal y mensual con consejos',
    icon: '💡',
  },
  {
    key: 'monthly_report',
    label: 'Cierre de mes',
    description: 'Reporte del mes cerrado cada día 1',
    icon: '📊',
  },
  {
    key: 'card_due',
    label: 'Vencimientos de tarjeta',
    description: 'Aviso 3 días antes del vencimiento',
    icon: '💳',
  },
  {
    key: 'settle_reminder',
    label: 'Saldar cuentas',
    description: 'Recordatorio mensual del balance de pareja',
    icon: '👫',
  },
] as const;

type PrefKey = (typeof PREFERENCES)[number]['key'];
type NotificationPrefs = Partial<Record<PrefKey, boolean>>;

export default function NotificacionesClient() {
  const supabase = createClient();
  const qc = useQueryClient();

  const { data: prefs, isLoading } = useQuery<NotificationPrefs>({
    queryKey: ['notification_prefs'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return {};
      const { data } = await supabase
        .from('profiles')
        .select('notification_prefs')
        .eq('id', user.id)
        .single();
      return (data?.notification_prefs as NotificationPrefs) ?? {};
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (next: NotificationPrefs) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from('profiles').update({ notification_prefs: next }).eq('id', user.id);
    },
    // Flip the toggle right away, roll back if the update fails.
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: ['notification_prefs'] });
      const previous = qc.getQueryData<NotificationPrefs>(['notification_prefs']);
      qc.setQueryData(['notification_prefs'], next);
      return { previous };
    },
    onError: (_err, _next, ctx) => {
      if (ctx?.previous !== undefined) qc.setQueryData(['notification_prefs'], ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['notification_prefs'] }),
  });

  // Absent key = enabled by default; only an explicit false disables.
  const isEnabled = (key: PrefKey) => prefs?.[key] !== false;

  function toggle(key: PrefKey) {
    if (!prefs) return;
    updateMutation.mutate({ ...prefs, [key]: !isEnabled(key) });
  }

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F1F5F3' }}>
      <header className="px-5 pt-14 pb-4 flex items-center gap-3">
        <Link href="/mas" className="text-2xl">←</Link>
        <h1 className="text-2xl font-black" style={{ color: '#18211D' }}>Notificaciones</h1>
      </header>

      <div className="px-4">
        <div className="rounded-3xl overflow-hidden" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
          {PREFERENCES.map((pref, i) => (
            <div
              key={pref.key}
              className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-[#F4F8F6]"
              style={{ borderTop: i > 0 ? '1px solid #E5EBE8' : 'none' }}
            >
              <span className="text-2xl">{pref.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm" style={{ color: '#18211D' }}>{pref.label}</p>
                <p className="text-xs mt-0.5" style={{ color: '#5B6660' }}>{pref.description}</p>
              </div>
              <button
                onClick={() => toggle(pref.key)}
                disabled={isLoading}
                className="relative w-12 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-50 active:scale-95"
                style={{ background: isEnabled(pref.key) ? '#2FA37C' : '#E5EBE8', boxShadow: isEnabled(pref.key) ? 'var(--shadow-soft)' : 'none' }}
                aria-checked={isEnabled(pref.key)}
                role="switch"
              >
                <span
                  className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform"
                  style={{ transform: isEnabled(pref.key) ? 'translateX(24px)' : 'translateX(0)', boxShadow: 'var(--shadow-card)' }}
                />
              </button>
            </div>
          ))}
        </div>
        <p className="text-xs mt-4 px-2" style={{ color: '#5B6660' }}>
          Las notificaciones requieren que hayas aceptado los permisos de notificaciones en tu dispositivo.
        </p>
      </div>
    </div>
  );
}
