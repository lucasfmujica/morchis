'use client';

interface NumberKeypadProps {
  onDigit: (d: string) => void;
  onBackspace: () => void;
  onConfirm?: () => void;
}

const KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['000', '0', '⌫'],
];

export function NumberKeypad({ onDigit, onBackspace, onConfirm }: NumberKeypadProps) {
  function handleKey(k: string) {
    if (k === '⌫') {
      onBackspace();
    } else {
      onDigit(k);
    }
  }

  return (
    <div className="grid grid-cols-3 gap-2 px-4">
      {KEYS.map((row, ri) =>
        row.map((k) => (
          <button
            key={`${ri}-${k}`}
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
