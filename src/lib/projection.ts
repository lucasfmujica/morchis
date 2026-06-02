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

  // Remaining recurring income: next_run is within the rest of this month
  const todayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`;
  const remainingIncome = filteredRules
    .filter(
      (r) =>
        r.active &&
        r.direction === 'income' &&
        r.next_run != null &&
        r.next_run > todayStr &&
        r.next_run <= monthEnd,
    )
    .reduce((s, r) => s + r.amount, 0);

  const remainingFixedExpenses = filteredRules
    .filter(
      (r) =>
        r.active &&
        r.direction === 'expense' &&
        r.next_run != null &&
        r.next_run > todayStr &&
        r.next_run <= monthEnd,
    )
    .reduce((s, r) => s + r.amount, 0);

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
      // Project: subtract daily variable rate, add any recurring on this day
      const ruleIncome = filteredRules
        .filter((r) => r.active && r.direction === 'income' && r.next_run === dayStr)
        .reduce((s, r) => s + r.amount, 0);
      const ruleExpense = filteredRules
        .filter((r) => r.active && r.direction === 'expense' && r.next_run === dayStr)
        .reduce((s, r) => s + r.amount, 0);
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
