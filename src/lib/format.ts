// Money formatting helpers — all math in TypeScript, never in LLM.
// Amounts are stored as numeric(14,2): up to 2 decimals. We show cents only
// when present (minimumFractionDigits: 0) so whole amounts stay clean.

export function formatARS(amount: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatUSD(amount: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format the raw string being typed on the keypad (e.g. "1234,8") into a
 * currency display WITHOUT round-tripping through a float. This keeps the
 * decimal comma visible the moment it's pressed and preserves trailing zeros
 * (so "0,80" shows as "$ 0,80", not "$ 0,8"). The integer part is grouped via
 * Intl so the currency symbol/spacing matches formatARS/formatUSD exactly.
 */
export function formatTypedAmount(raw: string, currency: 'ARS' | 'USD'): string {
  const commaAt = raw.indexOf(',');
  const intDigits = (commaAt === -1 ? raw : raw.slice(0, commaAt)).replace(/\D/g, '');
  const intValue = intDigits ? parseInt(intDigits, 10) : 0;
  const intDisplay = new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(intValue);
  if (commaAt === -1) return intDisplay;
  const decDigits = raw.slice(commaAt + 1).replace(/\D/g, '').slice(0, 2);
  return `${intDisplay},${decDigits}`;
}

export function arsToUsd(ars: number, rateArsPerUsd: number): number {
  return roundMoney(ars / rateArsPerUsd);
}

export function usdToArs(usd: number, rateArsPerUsd: number): number {
  return roundMoney(usd * rateArsPerUsd);
}

/** Round to 2 decimals for storage/display, avoiding float drift. */
export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Parse a money string into a number with up to 2 decimals.
 * Tolerant of es-AR formatting (1.234,56) and plain input (1234.56):
 * the LAST separator (',' or '.') is treated as the decimal point and any
 * earlier separators are thousands. Everything else is stripped.
 */
export function parseMoney(input: string): number {
  if (!input) return 0;
  const cleaned = input.replace(/[^\d.,]/g, '');
  if (!cleaned) return 0;
  const lastSep = Math.max(cleaned.lastIndexOf(','), cleaned.lastIndexOf('.'));
  let intPart: string;
  let decPart = '';
  if (lastSep === -1) {
    intPart = cleaned.replace(/\D/g, '');
  } else {
    intPart = cleaned.slice(0, lastSep).replace(/\D/g, '');
    decPart = cleaned.slice(lastSep + 1).replace(/\D/g, '').slice(0, 2);
  }
  const n = parseFloat(`${intPart || '0'}.${decPart || '0'}`);
  return Number.isFinite(n) ? roundMoney(n) : 0;
}
