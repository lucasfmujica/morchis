'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { todayISO, toLocalISO } from '@/lib/date';
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

      // Only count splits whose charge has already come due — up to the end of
      // the current month. A purchase in cuotas creates one transaction (and one
      // split) per month, so a future cuota must NOT inflate today's balance; it
      // joins the debt in the month it's actually charged. The split has no date
      // of its own, so we filter on the linked transaction's occurred_on via an
      // inner join.
      const now = new Date();
      const monthEnd = toLocalISO(new Date(now.getFullYear(), now.getMonth() + 1, 0));

      // All unsettled splits for this household whose cuota is due by month end.
      const { data: splits, error: splitsErr } = await supabase
        .from('splits')
        .select('payer_profile_id, ower_profile_id, amount, settled, transactions!inner(occurred_on)')
        .in('payer_profile_id', [myProfileId, partnerProfileId])
        .in('ower_profile_id', [myProfileId, partnerProfileId])
        .eq('settled', false)
        .lte('transactions.occurred_on', monthEnd);

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

      // Settlements adjust the balance. Money I paid the partner settles a debt
      // I owed (pushes net up, toward "partner owes me"); money the partner paid
      // me settles what they owed (pushes net down).
      const settledByMe = (settlements ?? [])
        .filter((s) => s.from_profile === myProfileId)
        .reduce((acc, s) => acc + s.amount, 0);

      const settledByPartner = (settlements ?? [])
        .filter((s) => s.from_profile === partnerProfileId)
        .reduce((acc, s) => acc + s.amount, 0);

      const net = iOwedToMe - iOwePartner + settledByMe - settledByPartner;

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
  occurredOn,
  fromAccountId,
  toAccountId,
}: {
  householdId: string;
  fromProfileId: string;
  toProfileId: string;
  amount: number;
  note?: string;
  /** Payment date. Defaults to today. */
  occurredOn?: string;
  /** Payer's account the money leaves from. Set together with toAccountId to
   *  also record the real money movement between the partners' accounts. */
  fromAccountId?: string | null;
  /** Receiver's account the money arrives in. */
  toAccountId?: string | null;
}) {
  const supabase = createClient();
  const date = occurredOn || todayISO();

  // Settlements are kept as a ledger and netted against the unsettled splits in
  // useCoupleBalance, so partial payments work and nothing double-counts. (We
  // deliberately do NOT flip splits.settled here — that would subtract the debt
  // twice, once via the cleared split and once via this settlement row.)
  const { error } = await supabase.from('settlements').insert({
    household_id: householdId,
    from_profile: fromProfileId,
    to_profile: toProfileId,
    amount,
    note: note || null,
    occurred_on: date,
  });
  if (error) throw error;

  // When the payment moved real money between the partners' accounts, also
  // record it as a transfer so both balances react (the payer's account drops,
  // the receiver's rises). Transfers are ignored by income/expense analytics, so
  // this only touches balances — it never double-counts the settlement. It
  // belongs to the payer (their account took the hit) and is ARS, matching the
  // couple-balance ledger.
  if (fromAccountId && toAccountId) {
    const { error: txErr } = await supabase.from('transactions').insert({
      household_id: householdId,
      profile_id: fromProfileId,
      type: 'transfer',
      amount,
      currency: 'ARS',
      account_id: fromAccountId,
      transfer_account_id: toAccountId,
      merchant: note || 'Pago a la pareja',
      occurred_on: date,
      scope: 'personal',
      is_shared: false,
      source: 'manual',
    });
    if (txErr) throw txErr;
  }
}
