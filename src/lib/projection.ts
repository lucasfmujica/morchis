export interface ProjectionTransaction {
  type: 'income' | 'expense' | 'transfer';
  amount: number;
  occurred_on: string;
  profile_id: string;
}

export interface ProjectionRule {
  direction: 'income' | 'expense';
  amount: number;
  next_run: string | null;
  active: boolean;
  profile_id: string;
  /** Defaults to 'monthly' when missing (one occurrence per remaining month). */
  cadence?: 'weekly' | 'biweekly' | 'monthly';
}

/** Every occurrence date of a rule in (fromExclusive, toInclusive], expanding
 *  weekly/biweekly so a rule that fires more than once in the rest of the month
 *  is counted that many times (the old code only counted next_run once). */
function occurrencesInRange(
  rule: ProjectionRule,
  fromExclusiveISO: string,
  toInclusiveISO: string,
): string[] {
  if (!rule.next_run) return [];
  const cadence = rule.cadence ?? 'monthly';
  const dates: string[] = [];
  const [y, m, d] = rule.next_run.split('-').map(Number);
  let cur = new Date(y, m - 1, d);
  const iso = (dt: Date) =>
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  let guard = 0;
  while (guard < 60) {
    const curISO = iso(cur);
    if (curISO > toInclusiveISO) break;
    if (curISO > fromExclusiveISO) dates.push(curISO);
    if (cadence === 'weekly') cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 7);
    else if (cadence === 'biweekly') cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 14);
    else cur = new Date(cur.getFullYear(), cur.getMonth() + 1, cur.getDate());
    guard += 1;
  }
  return dates;
}

export interface ProjectionResult {
  currentBalance: number;
  remainingIncome: number;
  remainingFixedExpenses: number;
  projectedVariableSpend: number;
  projectedBalance: number;
  expensesSoFar: number;
  incomeSoFar: number;
  daysElapsed: number;
  daysRemaining: number;
  /** one data point per day of month (index 0 = day 1), value = cumulative balance at end of day */
  dailyBalances: number[];
}

/**
 * Compute month-end projection.
 * scopeProfileId = undefined → all household; string → filter to that profile's transactions/rules
 */
export function computeProjection(
  transactions: ProjectionTransaction[],
  rules: ProjectionRule[],
  today: Date,
  scopeProfileId?: string,
): ProjectionResult {
  const year = today.getFullYear();
  const month = today.getMonth(); // 0-based
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dayOfMonth = today.getDate(); // 1-based
  const daysElapsed = Math.max(1, dayOfMonth);
  const daysRemaining = daysInMonth - dayOfMonth;

  const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const monthEnd = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  const filteredTx = scopeProfileId
    ? transactions.filter((t) => t.profile_id === scopeProfileId)
    : transactions;

  const filteredRules = scopeProfileId
    ? rules.filter((r) => r.profile_id === scopeProfileId)
    : rules;

  const txThisMonth = filteredTx.filter(
    (t) => t.occurred_on >= monthStart && t.occurred_on <= monthEnd,
  );

  const incomeSoFar = txThisMonth
    .filter((t) => t.type === 'income')
    .reduce((s, t) => s + t.amount, 0);

  const expensesSoFar = txThisMonth
    .filter((t) => t.type === 'expense')
    .reduce((s, t) => s + t.amount, 0);

  const currentBalance = incomeSoFar - expensesSoFar;

  // Remaining recurring amounts: count every occurrence left this month (so a
  // biweekly rule that fires twice in the rest of the month counts twice).
  const todayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`;
  const remainingIncome = filteredRules
    .filter((r) => r.active && r.direction === 'income')
    .reduce((s, r) => s + r.amount * occurrencesInRange(r, todayStr, monthEnd).length, 0);

  const remainingFixedExpenses = filteredRules
    .filter((r) => r.active && r.direction === 'expense')
    .reduce((s, r) => s + r.amount * occurrencesInRange(r, todayStr, monthEnd).length, 0);

  // Variable spend pace: expenses so far / days elapsed × days remaining
  const dailyRate = expensesSoFar / daysElapsed;
  const projectedVariableSpend = Math.round(dailyRate * daysRemaining);

  const projectedBalance =
    currentBalance + remainingIncome - remainingFixedExpenses - projectedVariableSpend;

  // Build daily balance series (one per day of month, up to today for actuals)
  const dailyBalances: number[] = [];
  let running = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const dayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (day <= dayOfMonth) {
      const dayIncome = txThisMonth
        .filter((t) => t.type === 'income' && t.occurred_on === dayStr)
        .reduce((s, t) => s + t.amount, 0);
      const dayExpense = txThisMonth
        .filter((t) => t.type === 'expense' && t.occurred_on === dayStr)
        .reduce((s, t) => s + t.amount, 0);
      running += dayIncome - dayExpense;
      dailyBalances.push(running);
    } else {
      // Project: subtract daily variable rate, add any recurring occurrences on
      // this day (expanded, so a biweekly rule hits both of its days).
      const ruleIncome = filteredRules
        .filter((r) => r.active && r.direction === 'income')
        .reduce((s, r) => s + r.amount * occurrencesInRange(r, todayStr, dayStr).filter((o) => o === dayStr).length, 0);
      const ruleExpense = filteredRules
        .filter((r) => r.active && r.direction === 'expense')
        .reduce((s, r) => s + r.amount * occurrencesInRange(r, todayStr, dayStr).filter((o) => o === dayStr).length, 0);
      running += ruleIncome - ruleExpense - dailyRate;
      dailyBalances.push(Math.round(running));
    }
  }

  return {
    currentBalance,
    remainingIncome,
    remainingFixedExpenses,
    projectedVariableSpend,
    projectedBalance,
    expensesSoFar,
    incomeSoFar,
    daysElapsed,
    daysRemaining,
    dailyBalances,
  };
}
