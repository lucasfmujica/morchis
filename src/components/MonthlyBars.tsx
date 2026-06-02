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
              style={{ width: 12, height: `${(r.income / max) * 100}%`, minHeight: r.income > 0 ? 3 : 0, background: '#7EC8A4' }}
            />
            <div
              className="rounded-t-md"
              style={{ width: 12, height: `${(r.expense / max) * 100}%`, minHeight: r.expense > 0 ? 3 : 0, background: '#FF7F6B' }}
            />
          </div>
          <span className="text-[10px] font-semibold" style={{ color: '#6B6459' }}>{r.label}</span>
          {showRate && (
            <span
              className="text-[10px] font-bold"
              style={{ color: r.rate == null ? '#C4B9AE' : r.rate >= 0 ? '#5BA886' : '#E5604C' }}
            >
              {r.rate == null ? '—' : `${Math.round(r.rate * 100)}%`}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Single-series bars (e.g. one category's monthly spend). */
export function SingleBars({ rows, color = '#FF7F6B' }: { rows: { key: string; label: string; value: number }[]; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="flex items-end gap-2" style={{ height: 120 }}>
      {rows.map((r) => (
        <div key={r.key} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
          <div className="w-full flex justify-center" style={{ height: 96 }}>
            <div
              className="rounded-t-md self-end"
              style={{ width: 18, height: `${(r.value / max) * 100}%`, minHeight: r.value > 0 ? 3 : 0, background: color }}
            />
          </div>
          <span className="text-[10px] font-semibold" style={{ color: '#6B6459' }}>{r.label}</span>
        </div>
      ))}
    </div>
  );
}
