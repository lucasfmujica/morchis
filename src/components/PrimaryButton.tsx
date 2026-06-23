'use client';

// Primary CTA that visibly "lights up" when the form is valid: a rich emerald
// gradient + soft glow when ready, muted grey when the action isn't available
// yet, and a press-scale for tactile feedback. `disabled` = invalid/not ready;
// `loading` keeps the ready look but blocks interaction.
export function PrimaryButton({
  disabled = false,
  loading = false,
  onClick,
  children,
  className = '',
  type = 'button',
}: {
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
  type?: 'button' | 'submit';
}) {
  const ready = !disabled;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`rounded-2xl font-bold transition-all duration-200 active:scale-[0.97] ${className}`}
      style={{
        background: ready
          ? 'linear-gradient(180deg, #34AD84 0%, #2FA37C 55%, #1F8A68 100%)'
          : '#E5EBE8',
        color: ready ? '#FFFFFF' : '#9AA49E',
        boxShadow: ready ? 'var(--shadow-glow)' : 'none',
        opacity: loading ? 0.85 : 1,
      }}
    >
      {children}
    </button>
  );
}
