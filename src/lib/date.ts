// Local-timezone date helpers.
// IMPORTANT: never derive "today" / month keys / occurred_on from
// Date.toISOString() — that yields a UTC date, which in Argentina (UTC-3)
// rolls over to tomorrow after 21:00 local. Use these instead.

export function toLocalISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayISO(): string {
  return toLocalISO(new Date());
}

export function monthKey(d: Date = new Date()): string {
  return toLocalISO(d).slice(0, 7);
}
