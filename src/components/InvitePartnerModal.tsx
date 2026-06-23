'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase';
import { toast } from 'sonner';

export function InvitePartnerModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const supabase = createClient();
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function generateCode() {
    setLoading(true);
    const { data, error } = await supabase.rpc('generate_invite_code');
    if (!error && data) setCode(data as string);
    else toast.error('No se pudo generar el código.');
    setLoading(false);
  }

  useEffect(() => {
    if (open && !code && !loading) generateCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast.success('Código copiado ✓');
    } catch {
      /* clipboard not available */
    }
  }

  async function share() {
    if (!code) return;
    const text = `Sumate a nuestro hogar en Morchis con el código ${code}. Ingresalo en "Unirme con código" al crear tu cuenta. Expira en 7 días.`;
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ text });
      } catch {
        /* user cancelled */
      }
    } else {
      copy();
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center animate-in fade-in duration-200"
      style={{ background: 'rgba(20,28,24,0.42)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl p-5 pb-8 animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-pop)' }}>
        <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: '#E5EBE8' }} />

        <div className="text-center mb-4">
          <p className="text-4xl mb-2">💌</p>
          <h3 className="text-lg font-black" style={{ color: '#18211D' }}>Invitar a tu pareja</h3>
          <p className="text-sm mt-1" style={{ color: '#5B6660' }}>
            Compartí este código. Tu pareja lo ingresa en “Unirme con código” al crear su cuenta y entra al mismo hogar.
          </p>
        </div>

        <div className="rounded-2xl p-5 mb-4 text-center" style={{ background: '#DDF0E8' }}>
          {loading || !code ? (
            <p className="text-sm font-bold" style={{ color: '#1F8A68' }}>Generando código…</p>
          ) : (
            <>
              <div className="text-4xl font-black tracking-widest" style={{ color: '#1F8A68' }}>{code}</div>
              <p className="text-xs mt-1" style={{ color: '#5B6660' }}>Expira en 7 días</p>
            </>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={copy}
            disabled={!code}
            className="flex-1 py-3 rounded-2xl text-sm font-bold disabled:opacity-40"
            style={{ background: '#E5EBE8', color: '#18211D' }}
          >
            Copiar
          </button>
          <button
            onClick={share}
            disabled={!code}
            className="flex-1 py-3 rounded-2xl text-sm font-black text-white disabled:opacity-40"
            style={{ background: '#2FA37C' }}
          >
            Compartir
          </button>
        </div>

        <button
          onClick={onClose}
          className="w-full mt-3 py-2 text-sm font-semibold"
          style={{ color: '#5B6660' }}
        >
          Cerrar
        </button>
      </div>
    </div>
  );
}
