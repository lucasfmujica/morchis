// Pure dedup logic for parse-statement — NO imports, runs under Node/Vitest.

export function normalize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface DraftLike { date: string; amount: number; merchant: string }
export interface ExistingTx { occurred_on: string; amount: number; merchant: string | null }

export function isDuplicate(draft: DraftLike, existing: ExistingTx[]): boolean {
  return existing.some((tx) => {
    if (tx.occurred_on !== draft.date) return false;
    if (Math.abs(tx.amount - draft.amount) > 1) return false;
    const a = normalize(tx.merchant ?? "");
    const b = normalize(draft.merchant);
    // Require a real merchant match to suppress. The old behavior treated ANY
    // same-day same-amount row as a duplicate when either merchant was empty,
    // which silently dropped legitimate charges (two SUBE top-ups, two coffees).
    if (a.length === 0 || b.length === 0) return false;
    // fuzzy: one contains the other or edit distance small
    return a.includes(b) || b.includes(a);
  });
}
