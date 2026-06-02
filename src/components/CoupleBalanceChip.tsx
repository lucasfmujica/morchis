'use client';

import Link from 'next/link';
import { useCoupleBalance } from '@/hooks/useCouple';
import { formatARS } from '@/lib/format';

interface Props {
  householdId: string;
  myProfileId: string;
  partnerProfileId: string | undefined;
  partnerName: string | undefined;
}

export function CoupleBalanceChip({ householdId, myProfileId, partnerProfileId, partnerName }: Props) {
  const { net, loading } = useCoupleBalance(householdId, myProfileId, partnerProfileId);

  if (!partnerProfileId || loading) return null;

  const absNet = Math.abs(net);
  const balanced = net === 0;
  const partnerOwesMe = net > 0;

  const bg = balanced ? '#ECE5DC' : partnerOwesMe ? '#E4F2EA' : '#FFE7E2';
  const color = balanced ? '#6B6459' : partnerOwesMe ? '#5BA886' : '#E5604C';
  const label = balanced
    ? '🤝 Al día'
    : partnerOwesMe
    ? `${partnerName ?? 'Pareja'} te debe ${formatARS(absNet)}`
    : `Le debés ${formatARS(absNet)} a ${partnerName ?? 'pareja'}`;

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
