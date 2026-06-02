'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

export default function AuthPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setLoading(false);
    if (error) {
      if (error.status === 429) {
        toast.error('Demasiados intentos. Esperá unos minutos y volvé a intentar.');
      } else {
        toast.error(`Error: ${error.message}`);
      }
    } else {
      setSent(true);
    }
  }

  if (sent) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ background: '#F9F5F0' }}>
        <div className="text-6xl mb-6">📬</div>
        <h1 className="text-2xl font-bold text-center mb-3" style={{ color: '#2D2D2D' }}>
          ¡Revisá tu mail!
        </h1>
        <p className="text-center" style={{ color: '#8A8276' }}>
          Te mandamos un link a <strong>{email}</strong>. Tocalo para entrar a Morchis.
        </p>
        <button
          className="mt-8 text-sm underline"
          style={{ color: '#7EC8A4' }}
          onClick={() => setSent(false)}
        >
          Usar otro email
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ background: '#F9F5F0' }}>
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="text-5xl mb-3">💚</div>
          <h1 className="text-4xl font-black tracking-tight" style={{ color: '#2D2D2D' }}>
            Morchis
          </h1>
          <p className="text-base mt-1" style={{ color: '#8A8276' }}>
            Nuestra plata, juntos
          </p>
        </div>

        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-semibold mb-2"
              style={{ color: '#2D2D2D' }}
            >
              Tu email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vos@ejemplo.com"
              required
              className="w-full px-4 py-3 rounded-2xl text-base outline-none focus:ring-2 border"
              style={{
                background: '#FFFFFF',
                border: '1.5px solid #ECE5DC',
                color: '#2D2D2D',
              }}
              onFocus={(e) => (e.target.style.borderColor = '#7EC8A4')}
              onBlur={(e) => (e.target.style.borderColor = '#ECE5DC')}
            />
          </div>

          <button
            type="submit"
            disabled={loading || !email}
            className="w-full py-4 rounded-2xl text-base font-bold text-white transition-opacity disabled:opacity-50"
            style={{ background: '#7EC8A4' }}
          >
            {loading ? 'Enviando...' : 'Entrar con email'}
          </button>
        </form>

        <p className="text-center text-sm mt-8" style={{ color: '#8A8276' }}>
          Te mandamos un link mágico. Sin contraseñas.
        </p>
      </div>
    </div>
  );
}
