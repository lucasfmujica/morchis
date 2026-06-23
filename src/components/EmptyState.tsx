'use client';

interface EmptyStateProps {
  icon: string;
  title: string;
  subtitle?: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ icon, title, subtitle, action }: EmptyStateProps) {
  return (
    <div className="rounded-3xl p-8 text-center" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
      <p className="text-4xl mb-3">{icon}</p>
      <p className="font-semibold text-base" style={{ color: '#18211D' }}>{title}</p>
      {subtitle && (
        <p className="text-sm mt-1" style={{ color: '#5B6660' }}>{subtitle}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 px-5 py-2.5 rounded-2xl text-sm font-bold text-white"
          style={{ background: '#2FA37C' }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
