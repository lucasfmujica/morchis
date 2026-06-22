import { describe, it, expect } from 'vitest';
import { toArs, personalShareArs, type ShareTx } from './money.ts';

const BLUE = 1000;
const ME = 'me', PARTNER = 'partner';
const tx = (over: Partial<ShareTx> = {}): ShareTx => ({ profile_id: ME, is_shared: false, amount: 1000, currency: 'ARS', usd_rate_snapshot: null, splits: null, ...over });

describe('toArs', () => {
  it('passes ARS, converts USD via snapshot then blue', () => {
    expect(toArs(500, 'ARS', null, BLUE)).toBe(500);
    expect(toArs(10, 'USD', 1200, BLUE)).toBe(12000);
    expect(toArs(10, 'USD', null, BLUE)).toBe(10000);
    expect(toArs(10, 'USD', 0, BLUE)).toBe(10000); // 0 snapshot → blue
  });
});

describe('personalShareArs', () => {
  it('not shared → full if theirs, else 0', () => {
    expect(personalShareArs(tx({ profile_id: ME, amount: 700 }), ME, BLUE)).toBe(700);
    expect(personalShareArs(tx({ profile_id: PARTNER, amount: 700 }), ME, BLUE)).toBe(0);
  });
  it('shared, they owe → their split', () => {
    const t = tx({ is_shared: true, profile_id: PARTNER, amount: 1000, splits: [{ payer_profile_id: PARTNER, ower_profile_id: ME, amount: 400 }] });
    expect(personalShareArs(t, ME, BLUE)).toBe(400);
  });
  it('shared, they paid → total minus what others owe them', () => {
    const t = tx({ is_shared: true, profile_id: ME, amount: 1000, splits: [{ payer_profile_id: ME, ower_profile_id: PARTNER, amount: 400 }] });
    expect(personalShareArs(t, ME, BLUE)).toBe(600);
  });
  it('shared with USD snapshot conversion', () => {
    const t = tx({ is_shared: true, profile_id: PARTNER, currency: 'USD', usd_rate_snapshot: 1200, amount: 10, splits: [{ payer_profile_id: PARTNER, ower_profile_id: ME, amount: 5000 }] });
    expect(personalShareArs(t, ME, BLUE)).toBe(5000); // ower split is already ARS
  });
});
