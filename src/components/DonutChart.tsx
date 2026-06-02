'use client';

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

// Inline SVG donut — no external dep, matches the Sparkline approach.
export function DonutChart({
  segments,
  size = 148,
  thickness = 22,
  centerTop,
  centerBottom,
}: {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  centerTop?: string;
  centerBottom?: string;
}) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  const r = (size - thickness) / 2;
  const circ = 2 * Math.PI * r;
  const cx = size / 2;
  const cy = size / 2;

  let offset = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Track */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#ECE5DC" strokeWidth={thickness} />
      {total > 0 &&
        segments.map((seg, i) => {
          const len = (seg.value / total) * circ;
          const el = (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth={thickness}
              strokeDasharray={`${len} ${circ - len}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          );
          offset += len;
          return el;
        })}
      {centerTop && (
        <text
          x={cx}
          y={cy - 2}
          textAnchor="middle"
          fontSize="11"
          fontWeight="700"
          fill="#8A8276"
        >
          {centerTop}
        </text>
      )}
      {centerBottom && (
        <text
          x={cx}
          y={cy + 14}
          textAnchor="middle"
          fontSize="15"
          fontWeight="800"
          fill="#2D2D2D"
        >
          {centerBottom}
        </text>
      )}
    </svg>
  );
}
