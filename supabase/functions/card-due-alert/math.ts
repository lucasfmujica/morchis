// Pure date math for card-due-alert — NO imports, runs under Node/Vitest.
// Credit-card billing cycle / due-date arithmetic, clamped to month length.

export const isoOf = (d: Date) => d.toISOString().slice(0, 10);
export const fmtARS = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');

// Next monthly occurrence of `anchorISO`'s day-of-month that is >= today,
// clamped to each month's length (a day-31 anchor hits Feb 28 / Mar 31).
export function nextOccurrence(anchorISO: string, todayISO: string): string {
  const [, , dStr] = anchorISO.split('-');
  const anchorDay = Number(dStr);
  const [ty, tm] = todayISO.split('-').map(Number);
  for (let k = 0; k < 14; k++) {
    const probe = new Date(Date.UTC(ty, tm - 1 + k, 1));
    const lastDay = new Date(Date.UTC(probe.getUTCFullYear(), probe.getUTCMonth() + 1, 0)).getUTCDate();
    const cand = new Date(Date.UTC(probe.getUTCFullYear(), probe.getUTCMonth(), Math.min(anchorDay, lastDay)));
    const candISO = isoOf(cand);
    if (candISO >= todayISO) return candISO;
  }
  return todayISO;
}

// Previous occurrence strictly before `beforeISO`.
export function prevOccurrence(anchorISO: string, beforeISO: string): string {
  const next = nextOccurrence(anchorISO, beforeISO);
  const [y, m] = next.split('-').map(Number);
  const anchorDay = Number(anchorISO.split('-')[2]);
  const prevMonth = new Date(Date.UTC(y, m - 2, 1));
  const lastDay = new Date(Date.UTC(prevMonth.getUTCFullYear(), prevMonth.getUTCMonth() + 1, 0)).getUTCDate();
  return isoOf(new Date(Date.UTC(prevMonth.getUTCFullYear(), prevMonth.getUTCMonth(), Math.min(anchorDay, lastDay))));
}

export function daysBetween(aISO: string, bISO: string): number {
  return Math.round((Date.parse(bISO) - Date.parse(aISO)) / 86400000);
}
