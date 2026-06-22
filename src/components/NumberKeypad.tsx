'use client';

import { useEffect } from 'react';

interface NumberKeypadProps {
  onDigit: (d: string) => void;
  onBackspace: () => void;
  onConfirm?: () => void;
  // When provided, a fourth column of arithmetic operators is shown so the user
  // can do quick math (e.g. split a bill) while loading an amount. Left out for
  // the PIN keypad, which stays a plain 3-column numpad.
  onOperator?: (op: string) => void;
}

const KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  [',', '0', '⌫'],
];

// Same digits, with an operator column appended for the calculator variant.
const KEYS_WITH_OPS = [
  ['1', '2', '3', '÷'],
  ['4', '5', '6', '×'],
  ['7', '8', '9', '−'],
  [',', '0', '⌫', '+'],
];

// Display symbol -> the ASCII operator handed back to the caller.
const OP_SYMBOLS: Record<string, string> = { '÷': '/', '×': '*', '−': '-', '+': '+' };

const KEY_LABEL: Record<string, string> = {
  '⌫': 'Borrar',
  ',': 'Coma decimal',
  '÷': 'Dividir',
  '×': 'Multiplicar',
  '−': 'Restar',
  '+': 'Sumar',
};

export function NumberKeypad({ onDigit, onBackspace, onConfirm, onOperator }: NumberKeypadProps) {
  const keys = onOperator ? KEYS_WITH_OPS : KEYS;

  function handleKey(k: string) {
    if (k === '⌫') onBackspace();
    else if (OP_SYMBOLS[k]) onOperator?.(OP_SYMBOLS[k]);
    else onDigit(k);
  }

  // Hardware-keyboard support: digits, comma/period, operators, Backspace,
  // Enter — but only when focus isn't in a text field (so typing the
  // description isn't hijacked).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      if (e.key >= '0' && e.key <= '9') onDigit(e.key);
      else if (e.key === ',' || e.key === '.') onDigit(',');
      else if (onOperator && (e.key === '+' || e.key === '-' || e.key === '*' || e.key === '/')) onOperator(e.key);
      else if (e.key === 'Backspace') onBackspace();
      else if (e.key === 'Enter') onConfirm?.();
      else return;
      e.preventDefault();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onDigit, onBackspace, onConfirm, onOperator]);

  return (
    <div
      className={`grid ${onOperator ? 'grid-cols-4' : 'grid-cols-3'} gap-2 px-4`}
      role="group"
      aria-label="Teclado numérico"
    >
      {keys.map((row, ri) =>
        row.map((k) => {
          const isOp = !!OP_SYMBOLS[k];
          const isDel = k === '⌫';
          return (
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
                background: isDel ? '#FFE7E2' : isOp ? '#EAF1FE' : '#FFFFFF',
                color: isDel ? '#FF7F6B' : isOp ? '#5B8DEF' : '#2D2D2D',
                boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
              }}
            >
              {k}
            </button>
          );
        }),
      )}
    </div>
  );
}
