'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { useCurrencyStore } from '@/store/currency';
import { formatARS, formatUSD, arsToUsd } from '@/lib/format';

const FALLBACK_RATE = 1200;

export function useFx() {
  const { showUSD, toggle } = useCurrencyStore();
  const supabase = createClient();

  const { data: arsPerUsd = FALLBACK_RATE } = useQuery({
    queryKey: ['fx-rate-blue'],
    queryFn: async () => {
      const { data } = await supabase
        .from('fx_rates')
        .select('ars_per_usd')
        .eq('source', 'blue')
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data?.ars_per_usd ?? FALLBACK_RATE;
    },
    staleTime: 1000 * 60 * 60,
  });

  function format(ars: number): string {
    return showUSD ? formatUSD(arsToUsd(ars, arsPerUsd)) : formatARS(ars);
  }

  function secondary(ars: number): string {
    return showUSD ? formatARS(ars) : `≈ ${formatUSD(arsToUsd(ars, arsPerUsd))}`;
  }

  return { arsPerUsd, showUSD, toggle, format, secondary };
}
