'use client';

import Link from 'next/link';
import { useCoupleBalance } from '@/hooks/useCouple';
import { usePrivacyStore } from '@/store/privacy';
import { formatARS } from '@/lib/format';

interface Props {
  householdId: string;
  myProfileId: string;
  partnerProfileId: string | undefined;
  partnerName: string | undefined;
}

export function CoupleBalanceChip({ householdId, myProfileId, partnerProfileId, partnerName }: Props) {
  const { net, loading } = useCoupleBalance(householdId, myProfileId, partnerProfileId);
  const { hideAmounts } = usePrivacyStore();

  if (!partnerProfileId || loading) return null;

  const absNet = Math.abs(net);
  // Splits are rounded ARS, so treat sub-peso residue as settled.
  const balanced = absNet < 1;
  const partnerOwesMe = !balanced && net > 0;
  const amt = hideAmounts ? '••••••' : formatARS(absNet);

  const bg = balanced ? '#E5EBE8' : partnerOwesMe ? '#DDF0E8' : '#FFE5E0';
  const color = balanced ? '#5B6660' : partnerOwesMe ? '#1F8A68' : '#E25749';
  const label = balanced
    ? '🤝 Al día'
    : partnerOwesMe
    ? `${partnerName ?? 'Pareja'} te debe ${amt}`
    : `Le debés ${amt} a ${partnerName ?? 'pareja'}`;

  return (
    <Link
      href="/pareja"
      className="mx-4 mb-4 flex items-center gap-2 px-4 py-3 rounded-2xl"
      style={{ background: bg }}
    >
      <p className="flex-1 text-xs font-bold" style={{ color }}>{label}</p>
      <span className="text-xs" style={{ color }}>→</span>
    </Link>
  );
}
