'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const steps = [
  {
    emoji: '📱',
    title: 'Instalá Morchis en tu iPhone',
    body: (
      <>
        <p className="text-base text-center" style={{ color: '#8A8276' }}>
          Para que se abra como una app de verdad, seguí estos pasos en Safari:
        </p>
        <ol className="mt-4 space-y-3 text-left">
          {[
            { icon: '1️⃣', text: 'Abrí esta página en Safari' },
            { icon: '2️⃣', text: 'Tocá el botón Compartir (cuadrado con flecha ↑)' },
            { icon: '3️⃣', text: 'Elegí "Agregar a Inicio"' },
            { icon: '4️⃣', text: '¡Listo! Morchis aparece en tu pantalla de inicio 🎉' },
          ].map((s) => (
            <li key={s.icon} className="flex items-start gap-3">
              <span className="text-xl shrink-0">{s.icon}</span>
              <span className="text-base" style={{ color: '#2D2D2D' }}>{s.text}</span>
            </li>
          ))}
        </ol>
        <div className="mt-4 rounded-2xl p-3 text-sm text-center" style={{ background: '#FFE7E2', color: '#E5604C' }}>
          Sólo funciona en <strong>Safari</strong>. Chrome e Instagram browser no lo soportan.
        </div>
      </>
    ),
  },
  {
    emoji: '💚',
    title: '¡Todo listo, Morch!',
    body: (
      <p className="text-base text-center" style={{ color: '#8A8276' }}>
        Ya podés empezar a registrar gastos e ingresos juntos. Tocá <strong>+</strong> para agregar tu primer movimiento.
      </p>
    ),
  },
];

export default function OnboardingPage() {
  const [idx, setIdx] = useState(0);
  const router = useRouter();
  const isLast = idx === steps.length - 1;
  const step = steps[idx];

  function next() {
    if (isLast) {
      router.push('/home');
    } else {
      setIdx(idx + 1);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ background: '#F9F5F0' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-6xl mb-4">{step.emoji}</div>
          <h1 className="text-2xl font-black mb-4" style={{ color: '#2D2D2D' }}>
            {step.title}
          </h1>
          {step.body}
        </div>

        <div className="flex items-center gap-2 justify-center mb-6">
          {steps.map((_, i) => (
            <div
              key={i}
              className="h-2 rounded-full transition-all"
              style={{
                width: i === idx ? 24 : 8,
                background: i === idx ? '#7EC8A4' : '#ECE5DC',
              }}
            />
          ))}
        </div>

        <button
          onClick={next}
          className="w-full py-4 rounded-2xl text-base font-bold text-white"
          style={{ background: '#7EC8A4' }}
        >
          {isLast ? '¡Empecemos! 🚀' : 'Siguiente'}
        </button>

        {!isLast && (
          <button
            onClick={() => router.push('/home')}
            className="w-full py-3 text-sm text-center"
            style={{ color: '#8A8276' }}
          >
            Saltar
          </button>
        )}
      </div>
    </div>
  );
}
