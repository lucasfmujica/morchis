import { toLocalISO } from '@/lib/date';

// Shared recurrence math for `recurring_rules`. Extracted from reglas-client so
// the register strip (próximos vencimientos) and the cash-flow projection can
// reuse the exact same cadence logic the rules screen and the cron use.
//
// (ms arithmetic is safe here: Argentina has no DST, so days are always 24h.)

export interface RecurrenceLike {
  cadence: string; // 'weekly' | 'biweekly' | 'monthly'
  anchor_day: number | null;
  next_run: string | null;
}

// A day-of-month for a given year/month, clamped to that month's length — mirrors
// the cron's `least(anchor_day, last_day_of_month)`. Without this, anchor day 31
// in February makes `new Date(year, 1, 31)` overflow into March and the schedule
// drifts. So anchor_day 31 means "último día del mes".
export function dayOfMonth(year: number, month: number, day: number): Date {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, lastDay));
}

// Whole days from start-of-today to the given ISO date (negative = past).
export function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T00:00:00');
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

// Human label for a day offset: "Hoy" / "Mañana" / "En N días".
export function whenLabel(d: number): string {
  if (d <= 0) return 'Hoy';
  if (d === 1) return 'Mañana';
  return `En ${d} días`;
}

// Count how many times a given weekday (0=Sun..6=Sat) falls in a month.
export function weekdayOccurrencesInMonth(weekday: number, year: number, month: number): number {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let count = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    if (new Date(year, month, day).getDay() === weekday) count++;
  }
  return count;
}

// Normalize any cadence to the actual amount for the current month so totals
// reflect the real number of occurrences (e.g. a weekly expense on Thursdays
// counts the exact number of Thursdays in this month, not an average of 4.33;
// a biweekly one counts its actual 14-day cycle dates, which can be 1–3).
export function monthlyEquivalent(amount: number, cadence: string, anchorDay: number | null, nextRun: string | null): number {
  if (cadence === 'weekly') {
    const now = new Date();
    const weekday = anchorDay != null ? ((anchorDay % 7) + 7) % 7 : now.getDay();
    return amount * weekdayOccurrencesInMonth(weekday, now.getFullYear(), now.getMonth());
  }
  if (cadence === 'biweekly') {
    if (!nextRun) return amount * 2;
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const step = 14 * 86400000;
    const monthStart = new Date(year, month, 1).getTime();
    let t = new Date(nextRun + 'T00:00:00').getTime();
    while (t - step >= monthStart) t -= step;
    while (t < monthStart) t += step;
    let count = 0;
    for (let d = new Date(t); d.getFullYear() === year && d.getMonth() === month; d = new Date(d.getTime() + step)) {
      count++;
    }
    return amount * count;
  }
  return amount;
}

// Advance a date by one cycle of the rule's cadence. Mirrors the cron's
// advancement (+7 / +14 / same anchor day next month, clamped to month length).
export function advanceOccurrence(dateISO: string, rule: RecurrenceLike): string {
  const base = new Date(dateISO + 'T00:00:00');
  if (rule.cadence === 'weekly') return toLocalISO(new Date(base.getTime() + 7 * 86400000));
  if (rule.cadence === 'biweekly') return toLocalISO(new Date(base.getTime() + 14 * 86400000));
  const anchor = rule.anchor_day ?? base.getDate();
  return toLocalISO(dayOfMonth(base.getFullYear(), base.getMonth() + 1, anchor));
}

// Advance a rule's own next_run by one cycle WITHOUT posting — used to skip a
// single occurrence on the rules screen.
export function advanceNextRun(rule: RecurrenceLike): string {
  return advanceOccurrence(rule.next_run ?? toLocalISO(new Date()), rule);
}

// Expand a rule's future occurrence dates (ISO) within [fromISO, toISO]
// inclusive, walking from its next_run. Caps iterations as a safety net.
export function expandOccurrences(rule: RecurrenceLike, fromISO: string, toISO: string): string[] {
  if (!rule.next_run) return [];
  const out: string[] = [];
  let cur = rule.next_run;
  // Fast-forward to the window start if next_run is behind it.
  let guard = 0;
  while (cur < fromISO && guard++ < 1000) cur = advanceOccurrence(cur, rule);
  while (cur <= toISO && guard++ < 1000) {
    if (cur >= fromISO) out.push(cur);
    cur = advanceOccurrence(cur, rule);
  }
  return out;
}
