// Pure helpers for monthly-close — only the shared money kernel is imported, so
// this runs under Node/Vitest. Per-share math mirrors src/lib/budgets.ts. The
// handler keeps all I/O (Supabase queries, web-push crypto).
import { toArs, personalShareArs } from "../_shared/money.ts";

export { toArs };

export const isoUTC = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
export const fmt = (n: number): string => '$' + Math.round(n).toLocaleString('es-AR');
export const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export interface Split { payer_profile_id: string; ower_profile_id: string; amount: number }
export interface Exp { category_id: string | null; categories: { name: string } | null; profile_id: string; scope: string; is_shared: boolean; amount: number; currency: string; usd_rate_snapshot: number | null; splits: Split[] | null }
export interface Budget { id: string; category_id: string | null; scope: string; amount: number; currency: string | null; profile_id: string | null; period: string | null; categories: { name: string } | null }
export interface ProfileRow { id: string; nickname: string | null; display_name: string | null; notification_prefs: Record<string, boolean> | null }

export function spentForBudget(b: Budget, rows: Exp[], blue: number): number {
  const owner = b.profile_id ?? '';
  return rows.filter(t => b.category_id == null || t.category_id === b.category_id).reduce((sum, t) => {
    if (b.scope === 'household') return t.scope === 'household' ? sum + toArs(t.amount, t.currency, t.usd_rate_snapshot, blue) : sum;
    return sum + personalShareArs(t, owner, blue);
  }, 0);
}

export function prefOn(p: ProfileRow | undefined, key: string): boolean {
  return (p?.notification_prefs?.[key]) !== false; // absent = enabled
}
