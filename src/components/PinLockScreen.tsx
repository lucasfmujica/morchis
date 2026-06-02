'use client';

import { useState } from 'react';
import { NumberKeypad } from '@/components/NumberKeypad';
import { usePinStore, sha256Hex } from '@/store/pinStore';

const MAX_ATTEMPTS = 5;
const MAX_DIGITS = 6;

export function PinLockScreen() {
  const { pin, unlock } = usePinStore();
  const [digits, setDigits] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [error, setError] = useState('');

  async function handleConfirm() {
    if (digits.length < 4) { setError('Ingresá al menos 4 dígitos.'); return; }
    const hash = await sha256Hex(digits);
    if (hash === pin) {
      unlock();
    } else {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);
      setDigits('');
      if (newAttempts >= MAX_ATTEMPTS) {
        setError('Demasiados intentos. Cerrá y volvé a abrir la app.');
      } else {
        setError(`PIN incorrecto. Intentos restantes: ${MAX_ATTEMPTS - newAttempts}`);
      }
    }
  }

  function handleDigit(d: string) {
    if (attempts >= MAX_ATTEMPTS) return;
    if (digits.length >= MAX_DIGITS) return;
    setDigits((prev) => prev + d);
    setError('');
  }

  function handleBackspace() {
    setDigits((prev) => prev.slice(0, -1));
    setError('');
  }

  const blocked = attempts >= MAX_ATTEMPTS;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8"
      style={{ background: '#F9F5F0' }}
    >
      {/* Title */}
      <div className="text-center">
        <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: '#8A8276' }}>Morchis</p>
        <h1 className="text-2xl font-black" style={{ color: '#2D2D2D' }}>Ingresá tu PIN</h1>
      </div>

      {/* Dots */}
      <div className="flex gap-4">
        {Array.from({ length: MAX_DIGITS }).map((_, i) => (
          <div
            key={i}
            className="w-4 h-4 rounded-full transition-colors"
            style={{ background: i < digits.length ? '#7EC8A4' : '#ECE5DC' }}
          />
        ))}
      </div>

      {/* Error */}
      {error && (
        <p className="text-sm font-semibold text-center px-8" style={{ color: '#FF7F6B' }}>{error}</p>
      )}

      {/* Keypad */}
      {!blocked && (
        <div className="w-full max-w-xs">
          <NumberKeypad onDigit={handleDigit} onBackspace={handleBackspace} onConfirm={handleConfirm} />
          <button
            onClick={handleConfirm}
            disabled={digits.length < 4}
            className="mt-4 w-full py-4 rounded-2xl font-bold text-white mx-4 disabled:opacity-40"
            style={{ background: '#7EC8A4', width: 'calc(100% - 2rem)', marginLeft: '1rem' }}
          >
            Confirmar
          </button>
        </div>
      )}
    </div>
  );
}
