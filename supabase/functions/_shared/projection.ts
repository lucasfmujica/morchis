// Shared end-of-month projection math. NO imports → runs on Deno and Node/Vitest.
// Amounts handed in are already normalised to ARS. (simulate-purchase has its own
// copy for now; this is the version ask-morchis's project_month tool uses.)

export interface PTx { type: string; amount: number; occurred_on: string }
export interface PRule { direction: string; amount: number; next_run: string | null; active: boolean; cadence?: string | null }

// Every occurrence of a rule in (fromExclusive, toInclusive], expanding weekly/
// biweekly so a rule firing more than once in the rest of the month counts each time.
export function occurrencesInRange(rule: PRule, fromExclusiveISO: string, toInclusiveISO: string): string[] {
  if (!rule.next_run) return [];
  const cadence = rule.cadence ?? 'monthly';
  const dates: string[] = [];
  const [y, m, d] = rule.next_run.split('-').map(Number);
  let cur = new Date(Date.UTC(y, m - 1, d));
  const iso = (dt: Date) => `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  let guard = 0;
  while (guard < 60) {
    const curISO = iso(cur);
    if (curISO > toInclusiveISO) break;
    if (curISO > fromExclusiveISO) dates.push(curISO);
    if (cadence === 'weekly') cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), cur.getUTCDate() + 7));
    else if (cadence === 'biweekly') cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), cur.getUTCDate() + 14));
    else cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, cur.getUTCDate()));
    guard += 1;
  }
  return dates;
}

export interface Projection { expensesSoFar: number; currentBalance: number; remainingIncome: number; remainingFixed: number; projectedVariableSpend: number; projectedBalance: number; totalIncome: number }

export function computeProjection(txs: PTx[], rules: PRule[], today: Date): Projection {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const dayOfMonth = today.getUTCDate();
  const daysElapsed = Math.max(1, dayOfMonth);
  const daysRemaining = daysInMonth - dayOfMonth;
  const ms = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const me = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
  const todayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`;
  const thisMonth = txs.filter(t => t.occurred_on >= ms && t.occurred_on <= me);
  const incomeSoFar = thisMonth.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expensesSoFar = thisMonth.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const currentBalance = incomeSoFar - expensesSoFar;
  const remainingIncome = rules.filter(r => r.active && r.direction === 'income').reduce((s, r) => s + r.amount * occurrencesInRange(r, todayStr, me).length, 0);
  const remainingFixed = rules.filter(r => r.active && r.direction === 'expense').reduce((s, r) => s + r.amount * occurrencesInRange(r, todayStr, me).length, 0);
  const dailyRate = expensesSoFar / daysElapsed;
  const projectedVariableSpend = Math.round(dailyRate * daysRemaining);
  const projectedBalance = currentBalance + remainingIncome - remainingFixed - projectedVariableSpend;
  const totalIncome = incomeSoFar + remainingIncome;
  return { expensesSoFar, currentBalance, remainingIncome, remainingFixed, projectedVariableSpend, projectedBalance, totalIncome };
}
