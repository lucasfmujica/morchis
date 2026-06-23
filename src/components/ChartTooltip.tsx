'use client';

// Styled recharts tooltip — a small lifted card matching the "Menta & tinta"
// design system, replacing recharts' default white box. Pass it to a chart via
// `<Tooltip content={<ChartTooltip formatter={formatARS} />} />`; recharts
// injects `active`/`payload`/`label`.
interface TooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
}

export function ChartTooltip({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  formatter?: (v: number) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      className="rounded-xl px-3 py-2"
      style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-pop)', border: '1px solid #E5EBE8' }}
    >
      {label != null && label !== '' && (
        <p className="text-[11px] font-bold mb-1" style={{ color: '#8C968F' }}>{label}</p>
      )}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color || '#2FA37C' }} />
          {p.name != null && (
            <span className="font-semibold" style={{ color: '#5B6660' }}>{p.name}</span>
          )}
          <span className="font-black tabular-nums ml-auto pl-4" style={{ color: '#18211D' }}>
            {formatter && typeof p.value === 'number' ? formatter(p.value) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}
