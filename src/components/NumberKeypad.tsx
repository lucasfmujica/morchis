'use client';

import { useEffect } from 'react';

interface NumberKeypadProps {
  onDigit: (d: string) => void;
  onBackspace: () => void;
  onConfirm?: () => void;
}

const KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  [',', '0', '⌫'],
];

const KEY_LABEL: Record<string, string> = { '⌫': 'Borrar', ',': 'Coma decimal' };

export function NumberKeypad({ onDigit, onBackspace, onConfirm }: NumberKeypadProps) {
  function handleKey(k: string) {
    if (k === '⌫') {
      onBackspace();
    } else {
      onDigit(k);
    }
  }

  // Hardware-keyboard support: digits, comma/period, Backspace, Enter — but only
  // when focus isn't in a text field (so typing the description isn't hijacked).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      if (e.key >= '0' && e.key <= '9') onDigit(e.key);
      else if (e.key === ',' || e.key === '.') onDigit(',');
      else if (e.key === 'Backspace') onBackspace();
      else if (e.key === 'Enter') onConfirm?.();
      else return;
      e.preventDefault();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onDigit, onBackspace, onConfirm]);

  return (
    <div className="grid grid-cols-3 gap-2 px-4" role="group" aria-label="Teclado numérico">
      {KEYS.map((row, ri) =>
        row.map((k) => (
          <button
            key={`${ri}-${k}`}
            type="button"
            aria-label={KEY_LABEL[k] ?? k}
            onPointerDown={(e) => {
              e.preventDefault();
              handleKey(k);
            }}
            className="h-16 rounded-2xl text-2xl font-bold flex items-center justify-center active:scale-95 transition-transform select-none"
            style={{
              background: k === '⌫' ? '#FFE7E2' : '#FFFFFF',
              color: k === '⌫' ? '#FF7F6B' : '#2D2D2D',
              boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
            }}
          >
            {k}
          </button>
        )),
      )}
    </div>
  );
}
