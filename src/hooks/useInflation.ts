'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';

interface InflationRate {
  date: string;
  monthly_pct: number;
  source: string;
}

export function useInflation() {
  const supabase = createClient();

  const { data: rates = [] } = useQuery<InflationRate[]>({
    queryKey: ['inflation-rates'],
    queryFn: async () => {
      const { data } = await supabase
        .from('inflation_rates')
        .select('date, monthly_pct, source')
        .order('date', { ascending: false })
        .limit(36);
      return (data ?? []) as InflationRate[];
    },
    staleTime: 1000 * 60 * 60 * 24,
  });

  const latestRate = rates[0] ?? null;
  const latestMonthlyPct = latestRate?.monthly_pct ?? null;
  // e.g. "2025-03" from "2025-03-01"
  const latestMonth = latestRate ? latestRate.date.slice(0, 7) : null;

  /**
   * Deflate `amount` (current ARS) to constant pesos of `baseDate`.
   * baseDate: YYYY-MM or YYYY-MM-DD string.
   * Returns amount as if inflation since baseDate never happened.
   */
  function arsToRealARS(amount: number, baseDate: string): number {
    if (rates.length === 0) return amount;
    const base = baseDate.slice(0, 7);
    const sorted = [...rates].sort((a, b) => a.date.localeCompare(b.date));
    // Months strictly after base up to latest
    const chain = sorted.filter((r) => r.date.slice(0, 7) > base);
    const factor = chain.reduce((acc, r) => acc * (1 + r.monthly_pct / 100), 1);
    return factor > 0 ? Math.round(amount / factor) : amount;
  }

  /**
   * Project `amount` forward by `months` using the latest monthly rate.
   * Used to adjust an ARS goal target by expected inflation to the deadline.
   */
  function inflatedTarget(amount: number, months: number): number {
    if (!latestMonthlyPct || months <= 0) return amount;
    const factor = Math.pow(1 + latestMonthlyPct / 100, months);
    return Math.round(amount * factor);
  }

  return {
    latestMonthlyPct,
    latestMonth,
    rates,
    arsToRealARS,
    inflatedTarget,
  };
}
