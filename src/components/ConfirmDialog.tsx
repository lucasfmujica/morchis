'use client';

// Styled confirm dialog to replace the native window.confirm().
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Eliminar',
  cancelLabel = 'Cancelar',
  danger = true,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-6"
      style={{ background: 'rgba(45,45,45,0.4)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="w-full max-w-sm rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
        <p className="text-base font-black mb-1" style={{ color: '#2D2D2D' }}>{title}</p>
        {message && <p className="text-sm mb-4" style={{ color: '#6B6459' }}>{message}</p>}
        <div className="flex gap-3 mt-2">
          <button
            onClick={onCancel}
            className="flex-1 py-3 rounded-2xl text-sm font-bold transition-all duration-150 active:scale-[0.97]"
            style={{ background: '#F0EDE8', color: '#2D2D2D', border: '1px solid #E0D8CC' }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-3 rounded-2xl text-sm font-bold text-white"
            style={{ background: danger ? '#FF7F6B' : '#7EC8A4' }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
