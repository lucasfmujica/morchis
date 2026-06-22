// Pure budget-suggestion math for suggest-budgets — NO imports, runs under Node/Vitest.
// HARD RULE (mirrored from the handler): suggested amounts are computed here from
// real history; Claude only writes a rationale string. It never picks the number.

export const fmt = (n: number): string => '$' + Math.round(n).toLocaleString('es-AR');
export const iso = (y: number, m: number, d: number) => new Date(y, m, d).toISOString().slice(0, 10);

// Round a raw average up to a "nice" budget figure so suggestions read cleanly.
export function niceRound(n: number): number {
  if (n <= 0) return 0;
  const step = n < 50000 ? 5000 : n < 200000 ? 10000 : 25000;
  return Math.ceil(n / step) * step;
}

export interface Cat { id: string; name: string }
export interface Suggestion { category_id: string; name: string; suggested: number; avg3m: number; lastMonth: number; projected: number; rationale: string; }

// Candidates: expense categories WITHOUT an active budget, with a meaningful
// history. Base the figure on the larger of the 3-month average, last month, and
// this month projected to full month; round up; keep those ≥ $10.000; top 8.
export function buildSuggestions(
  cats: Cat[], budgeted: Set<string>,
  hist3: Record<string, number>, last1: Record<string, number>, cur0: Record<string, number>,
  day: number, dim: number,
): Suggestion[] {
  return cats
    .filter(c => !budgeted.has(c.id))
    .map(c => {
      const avg3m = Math.round((hist3[c.id] ?? 0) / 3);
      const lastMonth = Math.round(last1[c.id] ?? 0);
      const projected = day > 0 ? Math.round((cur0[c.id] ?? 0) / day * dim) : Math.round(cur0[c.id] ?? 0);
      const base = Math.max(avg3m, lastMonth, projected);
      return { category_id: c.id, name: c.name, suggested: niceRound(base), avg3m, lastMonth, projected, rationale: '' };
    })
    .filter(s => s.suggested >= 10000)
    .sort((a, b) => b.suggested - a.suggested)
    .slice(0, 8);
}
