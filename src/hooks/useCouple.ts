'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { todayISO } from '@/lib/date';
import { toast } from 'sonner';

export interface CoupleBalance {
  /** Positive = partner owes me. Negative = I owe partner. */
  net: number;
  /** ARS total of all unsettled splits where I paid */
  iOwedToMe: number;
  /** ARS total of all unsettled splits where partner paid */
  iOwePartner: number;
  loading: boolean;
}

export function useCoupleBalance(
  householdId: string,
  myProfileId: string,
  partnerProfileId: string | undefined,
) {
  const supabase = createClient();

  const { data, isLoading } = useQuery({
    queryKey: ['couple-balance', householdId, myProfileId, partnerProfileId],
    enabled: !!partnerProfileId,
    queryFn: async () => {
      if (!partnerProfileId) return { net: 0, iOwedToMe: 0, iOwePartner: 0 };

      // All unsettled splits for this household
      const { data: splits, error: splitsErr } = await supabase
        .from('splits')
        .select('payer_profile_id, ower_profile_id, amount, settled')
        .in('payer_profile_id', [myProfileId, partnerProfileId])
        .in('ower_profile_id', [myProfileId, partnerProfileId])
        .eq('settled', false);

      if (splitsErr) throw splitsErr;

      // All settlements between the two
      const { data: settlements, error: settleErr } = await supabase
        .from('settlements')
        .select('from_profile, to_profile, amount')
        .eq('household_id', householdId)
        .in('from_profile', [myProfileId, partnerProfileId])
        .in('to_profile', [myProfileId, partnerProfileId]);

      if (settleErr) throw settleErr;

      // Splits: I paid → partner owes me
      const iOwedToMe = (splits ?? [])
        .filter((s) => s.payer_profile_id === myProfileId)
        .reduce((acc, s) => acc + s.amount, 0);

      // Splits: partner paid → I owe partner
      const iOwePartner = (splits ?? [])
        .filter((s) => s.payer_profile_id === partnerProfileId)
        .reduce((acc, s) => acc + s.amount, 0);

      // Settlements reduce the balance
      const settledByMe = (settlements ?? [])
        .filter((s) => s.from_profile === myProfileId)
        .reduce((acc, s) => acc + s.amount, 0);

      const settledByPartner = (settlements ?? [])
        .filter((s) => s.from_profile === partnerProfileId)
        .reduce((acc, s) => acc + s.amount, 0);

      const net = iOwedToMe - iOwePartner - settledByMe + settledByPartner;

      return { net, iOwedToMe, iOwePartner };
    },
  });

  return {
    net: data?.net ?? 0,
    iOwedToMe: data?.iOwedToMe ?? 0,
    iOwePartner: data?.iOwePartner ?? 0,
    loading: isLoading,
  };
}

export async function recordSettlement({
  householdId,
  fromProfileId,
  toProfileId,
  amount,
  note,
}: {
  householdId: string;
  fromProfileId: string;
  toProfileId: string;
  amount: number;
  note?: string;
}) {
  const supabase = createClient();
  const { error } = await supabase.from('settlements').insert({
    household_id: householdId,
    from_profile: fromProfileId,
    to_profile: toProfileId,
    amount,
    note: note || null,
    occurred_on: todayISO(),
  });
  if (error) throw error;
}
