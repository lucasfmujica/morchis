// Shared account-balance math so Home, Cuentas and Análisis agree.
// Asset balance = initial + incomes - expenses (up to a date).
// Credit cards are excluded from net worth (we only track their monthly spend).

export interface AccountRow {
  id: string;
  type: string;
  currency: string;
  archived: boolean;
  initial_balance: number;
  owner_profile_id?: string | null;
}

export interface AccountTx {
  account_id: string | null;
  type: string;
  amount: number;
  occurred_on: string;
}

export function assetBalance(tx: AccountTx[], accountId: string, initial: number, asOfISO: string): number {
  return tx
    .filter((t) => t.account_id === accountId && t.occurred_on <= asOfISO)
    .reduce((s, t) => s + (t.type === 'income' ? t.amount : t.type === 'expense' ? -t.amount : 0), initial);
}

export function cardMonthSpend(tx: AccountTx[], accountId: string, monthStartISO: string, asOfISO: string): number {
  return tx
    .filter((t) => t.account_id === accountId && t.type === 'expense' && t.occurred_on >= monthStartISO && t.occurred_on <= asOfISO)
    .reduce((s, t) => s + t.amount, 0);
}

/** Total net worth in ARS across non-credit, non-archived accounts (USD converted when a rate is known). */
export function netWorthAt(
  accounts: AccountRow[],
  tx: AccountTx[],
  asOfISO: string,
  arsPerUsd: number,
): number {
  let total = 0;
  for (const a of accounts) {
    if (a.archived || a.type === 'credit') continue;
    const bal = assetBalance(tx, a.id, a.initial_balance ?? 0, asOfISO);
    total += a.currency === 'USD' && arsPerUsd > 0 ? bal * arsPerUsd : bal;
  }
  return Math.round(total);
}
