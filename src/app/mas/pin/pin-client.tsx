'use client';

import { useState } from 'react';
import Link from 'next/link';
import { NumberKeypad } from '@/components/NumberKeypad';
import { usePinStore, sha256Hex } from '@/store/pinStore';

const MAX_DIGITS = 6;

type Step = 'menu' | 'enter' | 'confirm';

function PinInput({ digits, maxDigits }: { digits: string; maxDigits: number }) {
  return (
    <div className="flex gap-4 justify-center">
      {Array.from({ length: maxDigits }).map((_, i) => (
        <div
          key={i}
          className="w-4 h-4 rounded-full transition-colors"
          style={{ background: i < digits.length ? '#7EC8A4' : '#ECE5DC' }}
        />
      ))}
    </div>
  );
}

export default function PinClient() {
  const { pin, setPin } = usePinStore();
  const [step, setStep] = useState<Step>('menu');
  const [firstPin, setFirstPin] = useState('');
  const [digits, setDigits] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  function handleDigit(d: string) {
    if (digits.length >= MAX_DIGITS) return;
    setDigits((p) => p + d);
    setError('');
  }

  function handleBackspace() {
    setDigits((p) => p.slice(0, -1));
  }

  async function handleConfirm() {
    if (digits.length < 4) { setError('Ingresá al menos 4 dígitos.'); return; }
    if (step === 'enter') {
      setFirstPin(digits);
      setDigits('');
      setStep('confirm');
    } else if (step === 'confirm') {
      if (digits !== firstPin) {
        setError('Los PINs no coinciden. Intentá de nuevo.');
        setDigits('');
        setFirstPin('');
        setStep('enter');
        return;
      }
      await setPin(digits);
      setSuccess('PIN configurado correctamente.');
      setStep('menu');
      setDigits('');
      setFirstPin('');
    }
  }

  async function handleDisable() {
    await setPin(null);
    setSuccess('PIN desactivado.');
  }

  const hasPin = pin !== null;

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F9F5F0' }}>
      <header className="px-5 pt-14 pb-4 flex items-center gap-3">
        <Link href="/mas" className="text-2xl">←</Link>
        <h1 className="text-2xl font-black" style={{ color: '#2D2D2D' }}>Bloqueo con PIN</h1>
      </header>

      <div className="px-4 flex flex-col gap-4">
        {success && (
          <div className="rounded-2xl px-4 py-3 text-sm font-semibold" style={{ background: '#E4F2EA', color: '#5BA886' }}>
            {success}
          </div>
        )}

        {step === 'menu' && (
          <div className="rounded-3xl overflow-hidden" style={{ background: '#FFFFFF' }}>
            {hasPin ? (
              <>
                <div className="px-5 py-4" style={{ borderBottom: '1px solid #ECE5DC' }}>
                  <p className="font-semibold" style={{ color: '#2D2D2D' }}>PIN activo</p>
                  <p className="text-sm mt-0.5" style={{ color: '#6B6459' }}>Tu app está protegida con PIN.</p>
                </div>
                <button
                  onClick={() => { setStep('enter'); setDigits(''); setError(''); setSuccess(''); }}
                  className="w-full px-5 py-4 text-left font-semibold"
                  style={{ borderBottom: '1px solid #ECE5DC', color: '#2D2D2D' }}
                >
                  Cambiar PIN →
                </button>
                <button
                  onClick={handleDisable}
                  className="w-full px-5 py-4 text-left font-semibold"
                  style={{ color: '#FF7F6B' }}
                >
                  Desactivar PIN
                </button>
              </>
            ) : (
              <div className="px-5 py-6 text-center">
                <p className="text-3xl mb-3">🔐</p>
                <p className="font-bold mb-1" style={{ color: '#2D2D2D' }}>Sin PIN configurado</p>
                <p className="text-sm mb-4" style={{ color: '#6B6459' }}>Configurá un PIN para proteger tu app.</p>
                <button
                  onClick={() => { setStep('enter'); setDigits(''); setError(''); setSuccess(''); }}
                  className="px-6 py-3 rounded-2xl font-bold text-white"
                  style={{ background: '#7EC8A4' }}
                >
                  Configurar PIN
                </button>
              </div>
            )}
          </div>
        )}

        {(step === 'enter' || step === 'confirm') && (
          <div className="flex flex-col items-center gap-6 pt-4">
            <p className="text-base font-bold" style={{ color: '#2D2D2D' }}>
              {step === 'enter' ? 'Ingresá tu nuevo PIN (4–6 dígitos)' : 'Confirmá tu PIN'}
            </p>

            <PinInput digits={digits} maxDigits={MAX_DIGITS} />

            {error && (
              <p className="text-sm font-semibold" style={{ color: '#FF7F6B' }}>{error}</p>
            )}

            <div className="w-full max-w-xs">
              <NumberKeypad onDigit={handleDigit} onBackspace={handleBackspace} onConfirm={handleConfirm} />
              <div className="flex gap-3 mt-4 px-4">
                <button
                  onClick={() => { setStep('menu'); setDigits(''); setFirstPin(''); setError(''); }}
                  className="flex-1 py-3 rounded-2xl border font-bold text-sm"
                  style={{ borderColor: '#ECE5DC', color: '#6B6459' }}
                >
                  Cancelar
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={digits.length < 4}
                  className="flex-1 py-3 rounded-2xl font-bold text-sm text-white disabled:opacity-40"
                  style={{ background: '#7EC8A4' }}
                >
                  {step === 'enter' ? 'Siguiente' : 'Guardar'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
