'use client';

// Secondary action (Cancel/back). A filled neutral button with dark text
// so it reads as a real, tappable button — not a disabled/ghost element.
export function SecondaryButton({
  onClick,
  children,
  className = '',
  type = 'button',
}: {
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      className={`rounded-2xl font-bold transition-all duration-150 active:scale-[0.97] ${className}`}
      style={{ background: '#F0EDE8', color: '#2D2D2D', border: '1px solid #E0D8CC' }}
    >
      {children}
    </button>
  );
}
