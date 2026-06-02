'use client';

// Primary CTA that visibly "lights up" when the form is valid: vibrant
// green + glow when ready, muted grey when the action isn't available yet,
// and a press-scale for tactile feedback. `disabled` = invalid/not ready;
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
      className={`rounded-2xl font-bold transition-all duration-150 active:scale-[0.97] ${className}`}
      style={{
        background: ready ? '#7EC8A4' : '#E7E1D8',
        color: ready ? '#FFFFFF' : '#B3A998',
        boxShadow: ready ? '0 6px 16px rgba(126,200,164,0.5)' : 'none',
        opacity: loading ? 0.85 : 1,
      }}
    >
      {children}
    </button>
  );
}
