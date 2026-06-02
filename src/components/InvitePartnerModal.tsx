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
      className="fixed inset-0 z-50 flex items-end"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full rounded-t-3xl p-5 pb-8" style={{ background: '#FFFFFF' }}>
        <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: '#ECE5DC' }} />

        <div className="text-center mb-4">
          <p className="text-4xl mb-2">💌</p>
          <h3 className="text-lg font-black" style={{ color: '#2D2D2D' }}>Invitar a tu pareja</h3>
          <p className="text-sm mt-1" style={{ color: '#8A8276' }}>
            Compartí este código. Tu pareja lo ingresa en “Unirme con código” al crear su cuenta y entra al mismo hogar.
          </p>
        </div>

        <div className="rounded-2xl p-5 mb-4 text-center" style={{ background: '#E4F2EA' }}>
          {loading || !code ? (
            <p className="text-sm font-bold" style={{ color: '#5BA886' }}>Generando código…</p>
          ) : (
            <>
              <div className="text-4xl font-black tracking-widest" style={{ color: '#5BA886' }}>{code}</div>
              <p className="text-xs mt-1" style={{ color: '#8A8276' }}>Expira en 7 días</p>
            </>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={copy}
            disabled={!code}
            className="flex-1 py-3 rounded-2xl text-sm font-bold disabled:opacity-40"
            style={{ background: '#ECE5DC', color: '#2D2D2D' }}
          >
            Copiar
          </button>
          <button
            onClick={share}
            disabled={!code}
            className="flex-1 py-3 rounded-2xl text-sm font-black text-white disabled:opacity-40"
            style={{ background: '#7EC8A4' }}
          >
            Compartir
          </button>
        </div>

        <button
          onClick={onClose}
          className="w-full mt-3 py-2 text-sm font-semibold"
          style={{ color: '#8A8276' }}
        >
          Cerrar
        </button>
      </div>
    </div>
  );
}
