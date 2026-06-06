export interface NamedCategory {
  id: string;
  name: string;
}

// Unicode combining-marks range (U+0300–U+036F) — stripped after NFD so accents
// don't block matches. Built via RegExp to keep combining chars out of source.
const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');

// Accent-insensitive, lowercased — so "Comida" in the insight body matches the
// "comida" category regardless of casing/tildes.
function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(DIACRITICS, '').trim();
}

/**
 * Insights don't carry a category id (the LLM rewrites pre-computed facts into
 * free text), but category-specific cards mention the category by name. Find the
 * category whose name appears in the insight's title/body, preferring the
 * longest match so "Servicios digitales" wins over "Servicios". Returns null
 * when nothing clearly matches (e.g. saving/goal/debt insights).
 */
export function matchInsightCategoryId(text: string, categories: NamedCategory[]): string | null {
  const haystack = norm(text);
  let best: { id: string; len: number } | null = null;
  for (const c of categories) {
    const name = norm(c.name);
    // Skip very short names to avoid spurious substring hits.
    if (name.length < 3) continue;
    if (haystack.includes(name) && (!best || name.length > best.len)) {
      best = { id: c.id, len: name.length };
    }
  }
  return best?.id ?? null;
}
