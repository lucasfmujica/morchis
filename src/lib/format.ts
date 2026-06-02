// Money formatting helpers — all math in TypeScript, never in LLM.

export function formatARS(amount: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatUSD(amount: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function arsToUsd(ars: number, rateArsPerUsd: number): number {
  return Math.round(ars / rateArsPerUsd);
}

export function usdToArs(usd: number, rateArsPerUsd: number): number {
  return Math.round(usd * rateArsPerUsd);
}
