'use client';

export interface MonthBar {
  key: string;
  label: string;
  income: number;
  expense: number;
  /** optional savings rate to annotate under each column (income vs expense view) */
  rate?: number | null;
}

const MONTH_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

/** Last 6 month keys (oldest → current), e.g. { key: '2026-01', label: 'Ene' } */
export function lastSixMonths(today: Date): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ key, label: MONTH_LABELS[d.getMonth()] });
  }
  return out;
}

// Div-based grouped bars (responsive, no SVG width math). Pass showRate to annotate savings %.
export function MonthlyBars({ rows, showRate = true }: { rows: MonthBar[]; showRate?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.income, r.expense)));
  return (
    <div className="flex items-end gap-2" style={{ height: showRate ? 150 : 132 }}>
      {rows.map((r) => (
        <div key={r.key} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
          <div className="flex items-end gap-1 w-full justify-center" style={{ height: 110 }}>
            <div
              className="rounded-t-md"
              style={{ width: 12, height: `${(r.income / max) * 100}%`, minHeight: r.income > 0 ? 3 : 0, background: '#2FA37C' }}
            />
            <div
              className="rounded-t-md"
              style={{ width: 12, height: `${(r.expense / max) * 100}%`, minHeight: r.expense > 0 ? 3 : 0, background: '#FF6F61' }}
            />
          </div>
          <span className="text-[10px] font-semibold" style={{ color: '#5B6660' }}>{r.label}</span>
          {showRate && (
            <span
              className="text-[10px] font-bold"
              style={{ color: r.rate == null ? '#B0BAB4' : r.rate >= 0 ? '#1F8A68' : '#E25749' }}
            >
              {r.rate == null ? '—' : `${Math.round(r.rate * 100)}%`}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Single-series bars (e.g. one category's monthly spend). When `onSelect` is
 *  passed each bar becomes tappable (drill into that month) and `selectedKey`
 *  is highlighted. */
export function SingleBars({
  rows,
  color = '#FF6F61',
  onSelect,
  selectedKey,
}: {
  rows: { key: string; label: string; value: number }[];
  color?: string;
  onSelect?: (key: string) => void;
  selectedKey?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="flex items-end gap-2" style={{ height: 120 }}>
      {rows.map((r) => {
        const selected = selectedKey === r.key;
        const bar = (
          <>
            <div className="w-full flex justify-center" style={{ height: 96 }}>
              <div
                className="rounded-t-md self-end transition-opacity"
                style={{
                  width: 18,
                  height: `${(r.value / max) * 100}%`,
                  minHeight: r.value > 0 ? 3 : 0,
                  background: color,
                  opacity: !selectedKey || selected ? 1 : 0.45,
                }}
              />
            </div>
            <span
              className="text-[10px] font-semibold"
              style={{ color: selected ? color : '#5B6660' }}
            >
              {r.label}
            </span>
          </>
        );
        return onSelect ? (
          <button
            key={r.key}
            type="button"
            onClick={() => onSelect(r.key)}
            aria-label={`Ver ${r.label}`}
            aria-pressed={selected}
            className="flex-1 flex flex-col items-center gap-1 h-full justify-end"
          >
            {bar}
          </button>
        ) : (
          <div key={r.key} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
            {bar}
          </div>
        );
      })}
    </div>
  );
}
