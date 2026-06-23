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
      className={`rounded-2xl font-bold transition-all duration-200 active:scale-[0.97] ${className}`}
      style={{ background: '#FFFFFF', color: '#18211D', border: '1px solid #E5EBE8', boxShadow: 'var(--shadow-soft)' }}
    >
      {children}
    </button>
  );
}
