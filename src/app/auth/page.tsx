'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

type Mode = 'login' | 'signup' | 'reset';

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/callback`,
        });
        if (error) { toast.error(error.message); return; }
        toast.success('Te mandamos un link para cambiar tu contraseña. Revisá tu email.');
        setMode('login');
        return;
      }

      if (password.length < 6) {
        toast.error('La contraseña debe tener al menos 6 caracteres.');
        return;
      }

      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          toast.error('Email o contraseña incorrectos.');
          return;
        }
        router.push('/home');
        router.refresh();
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) { toast.error(error.message); return; }
        // Auto-login (works when email confirmation is disabled in Supabase)
        const { error: loginErr } = await supabase.auth.signInWithPassword({ email, password });
        if (!loginErr) {
          router.push('/home');
          router.refresh();
        } else {
          toast.success('¡Cuenta creada! Ahora ingresá con tu email y contraseña.');
          setMode('login');
        }
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ background: '#F9F5F0' }}>
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="text-5xl mb-3">💚</div>
          <h1 className="text-4xl font-black tracking-tight" style={{ color: '#2D2D2D' }}>Morchis</h1>
          <p className="text-base mt-1" style={{ color: '#8A8276' }}>Nuestra plata, juntos</p>
        </div>

        {/* Mode toggle (only login/signup) */}
        {mode !== 'reset' && (
          <div className="flex mb-6 rounded-2xl p-1" style={{ background: '#ECE5DC' }}>
            {(['login', 'signup'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className="flex-1 py-2.5 text-sm font-bold rounded-xl transition-colors"
                style={{
                  background: mode === m ? '#FFFFFF' : 'transparent',
                  color: mode === m ? '#2D2D2D' : '#8A8276',
                }}
              >
                {m === 'login' ? 'Entrar' : 'Crear cuenta'}
              </button>
            ))}
          </div>
        )}
        {mode === 'reset' && (
          <p className="text-base font-bold mb-6" style={{ color: '#2D2D2D' }}>Recuperar contraseña</p>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-semibold mb-1.5" style={{ color: '#2D2D2D' }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vos@ejemplo.com"
              required
              autoComplete="email"
              className="w-full px-4 py-3 rounded-2xl text-base outline-none border"
              style={{ background: '#FFFFFF', borderColor: '#ECE5DC', color: '#2D2D2D' }}
              onFocus={(e) => (e.target.style.borderColor = '#7EC8A4')}
              onBlur={(e) => (e.target.style.borderColor = '#ECE5DC')}
            />
          </div>

          {mode !== 'reset' && (
            <div>
              <label className="block text-sm font-semibold mb-1.5" style={{ color: '#2D2D2D' }}>Contraseña</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                required
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                className="w-full px-4 py-3 rounded-2xl text-base outline-none border"
                style={{ background: '#FFFFFF', borderColor: '#ECE5DC', color: '#2D2D2D' }}
                onFocus={(e) => (e.target.style.borderColor = '#7EC8A4')}
                onBlur={(e) => (e.target.style.borderColor = '#ECE5DC')}
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !email || (mode !== 'reset' && !password)}
            className="w-full py-4 rounded-2xl text-base font-bold text-white transition-opacity disabled:opacity-50 mt-2"
            style={{ background: '#7EC8A4' }}
          >
            {loading ? '…' : mode === 'login' ? 'Entrar' : mode === 'signup' ? 'Crear cuenta' : 'Enviar link'}
          </button>
        </form>

        {mode === 'login' && (
          <button
            onClick={() => setMode('reset')}
            className="block text-center text-xs mt-4 underline w-full"
            style={{ color: '#8A8276' }}
          >
            Olvidé mi contraseña
          </button>
        )}
        {mode === 'reset' && (
          <button
            onClick={() => setMode('login')}
            className="block text-center text-xs mt-4 underline w-full"
            style={{ color: '#8A8276' }}
          >
            ← Volver a entrar
          </button>
        )}

        <p className="text-center text-xs mt-6" style={{ color: '#8A8276' }}>
          Tu sesión se mantiene activa. No vas a tener que volver a entrar.
        </p>
      </div>
    </div>
  );
}
