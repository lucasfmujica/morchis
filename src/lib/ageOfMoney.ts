// YNAB-style "Age of Money": how old are the pesos you're spending?
//
// We FIFO-match cash inflows (income into on-budget accounts) to outflows (your
// share of expenses). The age of a spent peso is the number of days between the
// outflow and the inflow "lot" it came from (oldest money spent first). The Age
// of Money is the amount-weighted average age of the pesos consumed by the most
// recent N outflow transactions (YNAB uses 10). Returns null without enough data.

export interface CashFlow {
  date: string; // ISO 'YYYY-MM-DD'
  dir: 'in' | 'out';
  ars: number; // positive amount in ARS
}

const daysBetween = (from: string, to: string): number =>
  Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000));

export function ageOfMoneyDays(flows: CashFlow[], lastNOutflows = 10): number | null {
  const sorted = [...flows].sort((a, b) => a.date.localeCompare(b.date));
  const lots: { date: string; remaining: number }[] = [];
  // One entry per outflow transaction: the weighted age of the pesos it consumed.
  const outflows: { weightedAge: number; amount: number }[] = [];

  for (const f of sorted) {
    if (f.ars <= 0) continue;
    if (f.dir === 'in') {
      lots.push({ date: f.date, remaining: f.ars });
      continue;
    }
    let need = f.ars;
    let weightedAge = 0;
    let consumed = 0;
    while (need > 0 && lots.length > 0) {
      const lot = lots[0];
      const take = Math.min(need, lot.remaining);
      weightedAge += daysBetween(lot.date, f.date) * take;
      consumed += take;
      lot.remaining -= take;
      need -= take;
      if (lot.remaining <= 0.0001) lots.shift();
    }
    // `need > 0` here means we spent money we hadn't "received" yet (more
    // outflow than recorded inflow) — those pesos count as age 0.
    if (consumed > 0) outflows.push({ weightedAge, amount: consumed });
  }

  if (outflows.length === 0) return null;
  const recent = outflows.slice(-lastNOutflows);
  const totalAmount = recent.reduce((s, o) => s + o.amount, 0);
  const totalAge = recent.reduce((s, o) => s + o.weightedAge, 0);
  return totalAmount > 0 ? Math.round(totalAge / totalAmount) : null;
}
