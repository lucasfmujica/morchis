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

/** ISO start (Monday) and end (Sunday) of the week containing `d`. */
export function weekRange(d: Date = new Date()): { start: string; end: string } {
  const daysSinceMonday = (d.getDay() + 6) % 7; // getDay: 0=Sun..6=Sat
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysSinceMonday);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  return { start: toLocalISO(monday), end: toLocalISO(sunday) };
}

/** Short "DD/MM" for display (e.g. week range chips). */
export function shortDM(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}
