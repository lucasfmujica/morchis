// Pure envelope/budget math for budget-alert — NO imports, runs under Node/Vitest.
// Mirrors the in-app math in src/lib/envelope.ts.

export interface Split { payer_profile_id: string; ower_profile_id: string; amount: number }
export interface Tx {
  id: string;
  type: string;
  category_id: string | null;
  amount: number;
  currency: string;
  scope: string;
  profile_id: string;
  is_shared: boolean;
  occurred_on: string;
  account_id: string | null;
  transfer_account_id: string | null;
  exclude_from_stats?: boolean | null;
  splits?: Split[] | null;
}
export interface Account {
  id: string;
  type: string;
  currency: string;
  archived: boolean;
  initial_balance: number;
  owner_profile_id: string | null;
  on_budget: boolean;
  payment_category_id: string | null;
}
export interface Assignment { profile_id: string; category_id: string; month: string; assigned: number; currency: string }

export function toArs(amount: number, currency: string | null | undefined, rate: number): number {
  return currency === "USD" && rate > 0 ? Math.round(amount * rate) : amount;
}

export function myShareArs(t: Tx, profileId: string, rate: number): number {
  const total = toArs(t.amount, t.currency, rate);
  if (!t.is_shared) return total;
  const splits = t.splits ?? [];
  const iOwe = splits.filter((s) => s.ower_profile_id === profileId).reduce((a, s) => a + s.amount, 0);
  if (iOwe > 0) return iOwe;
  const owedToMe = splits.filter((s) => s.payer_profile_id === profileId).reduce((a, s) => a + s.amount, 0);
  if (owedToMe > 0) return Math.max(0, total - owedToMe);
  return t.profile_id === profileId ? total : 0;
}

export function expenseShareArs(t: Tx, profileId: string, rate: number, receivable: number): number {
  const gross = t.is_shared
    ? myShareArs(t, profileId, rate)
    : t.profile_id === profileId ? toArs(t.amount, t.currency, rate) : 0;
  return Math.max(0, gross - receivable);
}

export function assetBalance(tx: Tx[], accountId: string, initial: number, asOf: string): number {
  return tx.reduce((s, t) => {
    if (t.occurred_on > asOf) return s;
    if (t.account_id === accountId) {
      if (t.type === "income") return s + t.amount;
      if (t.type === "expense") return s - t.amount;
      if (t.type === "transfer") return s - t.amount;
      return s;
    }
    if (t.type === "transfer" && t.transfer_account_id === accountId) return s + t.amount;
    return s;
  }, initial);
}

export function onBudgetCashArs(accounts: Account[], tx: Tx[], profileId: string, asOf: string, rate: number): number {
  let total = 0;
  for (const a of accounts) {
    if (a.archived || !a.on_budget || a.type === "credit") continue;
    if (a.owner_profile_id !== profileId) continue;
    const bal = assetBalance(tx, a.id, a.initial_balance ?? 0, asOf);
    total += a.currency === "USD" && rate > 0 ? bal * rate : bal;
  }
  return Math.round(total);
}

export function activityByCategoryMonth(
  rows: Tx[], profileId: string, rate: number,
  payMap: Map<string, string>, receivableMap: Map<string, number>,
): Map<string, number> {
  const map = new Map<string, number>();
  const add = (cat: string, month: string, val: number) => {
    if (!val) return;
    const k = `${cat}__${month}`;
    map.set(k, (map.get(k) ?? 0) + val);
  };
  for (const t of rows) {
    // Transferencia/FX rows never touch an envelope (not consumption).
    if (t.exclude_from_stats) continue;
    const month = t.occurred_on.slice(0, 7);
    if (t.type === "expense") {
      const share = expenseShareArs(t, profileId, rate, receivableMap.get(t.id) ?? 0);
      if (share <= 0) continue;
      if (t.category_id) add(t.category_id, month, share);
      const payCat = t.account_id ? payMap.get(t.account_id) : undefined;
      if (payCat) add(payCat, month, -share);
    } else if (t.type === "transfer" && t.profile_id === profileId && t.transfer_account_id) {
      const payCat = payMap.get(t.transfer_account_id);
      if (payCat) add(payCat, month, toArs(t.amount, t.currency, rate));
    }
  }
  return map;
}

export function availableByCategory(assignments: Assignment[], activity: Map<string, number>, uptoMonth: string, rate: number): Map<string, number> {
  const out = new Map<string, number>();
  const bump = (cat: string, delta: number) => out.set(cat, (out.get(cat) ?? 0) + delta);
  for (const a of assignments) {
    if (a.month > uptoMonth) continue;
    bump(a.category_id, toArs(a.assigned, a.currency, rate));
  }
  for (const [k, act] of activity) {
    const sep = k.indexOf("__");
    if (k.slice(sep + 2) > uptoMonth) continue;
    bump(k.slice(0, sep), -act);
  }
  return out;
}

export function readyToAssign(cash: number, available: Map<string, number>): number {
  let funded = 0;
  for (const v of available.values()) if (v > 0) funded += v;
  return Math.round(cash - funded);
}

export function formatArs(n: number): string {
  return `$${Math.round(n).toLocaleString("es-AR")}`;
}
