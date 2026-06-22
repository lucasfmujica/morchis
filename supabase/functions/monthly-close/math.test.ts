import { describe, it, expect } from 'vitest';
import { toArs, spentForBudget, prefOn, isoUTC, fmt, type Exp, type Budget, type ProfileRow } from './math.ts';
import { personalShareArs } from '../_shared/money.ts';

const BLUE = 1000;
const ME = 'me', PARTNER = 'partner';

function exp(over: Partial<Exp> = {}): Exp {
  return {
    category_id: 'cat', categories: { name: 'Súper' }, profile_id: ME, scope: 'personal',
    is_shared: false, amount: 1000, currency: 'ARS', usd_rate_snapshot: null, splits: null, ...over,
  };
}

describe('toArs', () => {
  it('converts USD with snapshot/blue and passes ARS', () => {
    expect(toArs(10, 'USD', 1200, BLUE)).toBe(12000);
    expect(toArs(10, 'USD', null, BLUE)).toBe(10000);
    expect(toArs(500, 'ARS', null, BLUE)).toBe(500);
  });
});

describe('personalShareArs (shared kernel)', () => {
  it('handles personal, ower-split and payer cases', () => {
    expect(personalShareArs(exp({ amount: 800 }), ME, BLUE)).toBe(800);
    const shared = exp({ is_shared: true, profile_id: PARTNER, amount: 1000, splits: [{ payer_profile_id: PARTNER, ower_profile_id: ME, amount: 400 }] });
    expect(personalShareArs(shared, ME, BLUE)).toBe(400);
  });
});

describe('spentForBudget', () => {
  const rows: Exp[] = [
    exp({ category_id: 'food', scope: 'household', is_shared: true, profile_id: PARTNER, amount: 1000, splits: [{ payer_profile_id: PARTNER, ower_profile_id: ME, amount: 400 }] }),
    exp({ category_id: 'food', scope: 'personal', profile_id: ME, amount: 500 }),
    exp({ category_id: 'other', scope: 'personal', profile_id: ME, amount: 999 }),
  ];

  it('household-scope budget sums full household expenses in the category', () => {
    const b: Budget = { id: 'b', category_id: 'food', scope: 'household', amount: 0, currency: 'ARS', profile_id: null, period: null, categories: null };
    expect(spentForBudget(b, rows, BLUE)).toBe(1000); // only the household row, full
  });

  it('personal budget uses the owner share (split + own personal)', () => {
    const b: Budget = { id: 'b', category_id: 'food', scope: 'personal', amount: 0, currency: 'ARS', profile_id: ME, period: null, categories: null };
    // shared row → ME owes 400; personal row → 500; total 900
    expect(spentForBudget(b, rows, BLUE)).toBe(900);
  });

  it('a null category budget (total limit) spans all categories', () => {
    const b: Budget = { id: 'b', category_id: null, scope: 'personal', amount: 0, currency: 'ARS', profile_id: ME, period: null, categories: null };
    expect(spentForBudget(b, rows, BLUE)).toBe(400 + 500 + 999);
  });
});

describe('prefOn', () => {
  it('defaults to enabled when the pref is absent', () => {
    const p: ProfileRow = { id: ME, nickname: null, display_name: null, notification_prefs: null };
    expect(prefOn(p, 'monthly_report')).toBe(true);
    expect(prefOn({ ...p, notification_prefs: { monthly_report: false } }, 'monthly_report')).toBe(false);
    expect(prefOn(undefined, 'x')).toBe(true);
  });
});

describe('isoUTC / fmt', () => {
  it('formats UTC dates and ARS amounts', () => {
    expect(isoUTC(2026, 5, 1)).toBe('2026-06-01');
    expect(fmt(1234567)).toContain('1.234.567');
  });
});
