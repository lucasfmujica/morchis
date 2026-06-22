import { describe, it, expect } from 'vitest';
import {
  toArs, owedBackArs, shareForExpense, lensFraction, buildPrimer, jwtPayload, iso, MONTHLY,
  type ExpRow, type ItemParent, type Debt, type MoneyCtx,
} from './math.ts';

const BLUE = 1000; // 1 USD = 1000 ARS in these tests

// Two household members.
const ME = 'me';
const PARTNER = 'partner';

// Build an expense row with sensible defaults.
function exp(over: Partial<ExpRow> = {}): ExpRow {
  return {
    id: 'tx1', profile_id: ME, scope: 'personal', is_shared: false,
    amount: 1000, currency: 'ARS', usd_rate_snapshot: null, splits: null, ...over,
  };
}
const ctx = (over: Partial<MoneyCtx> = {}): MoneyCtx => ({ blue: BLUE, debtByTx: {}, ...over });

describe('toArs', () => {
  it('passes ARS through unchanged', () => {
    expect(toArs(1234, 'ARS', null, BLUE)).toBe(1234);
  });
  it('converts USD using the snapshot rate when present', () => {
    expect(toArs(10, 'USD', 1200, BLUE)).toBe(12000);
  });
  it('converts USD using blue when no snapshot', () => {
    expect(toArs(10, 'USD', null, BLUE)).toBe(10000);
  });
  it('falls back to blue when snapshot is 0 or NaN', () => {
    expect(toArs(10, 'USD', 0, BLUE)).toBe(10000);
    expect(toArs(10, 'USD', Number.NaN, BLUE)).toBe(10000);
  });
});

describe('owedBackArs', () => {
  it('sums only "owed" debts, converted to ARS', () => {
    const debtByTx: Record<string, Debt[]> = {
      tx1: [
        { transaction_id: 'tx1', direction: 'owed', amount: 300, currency: 'ARS' },
        { transaction_id: 'tx1', direction: 'owe', amount: 999, currency: 'ARS' }, // ignored
        { transaction_id: 'tx1', direction: 'owed', amount: 1, currency: 'USD' },  // 1*1000
      ],
    };
    expect(owedBackArs('tx1', debtByTx, BLUE)).toBe(1300);
  });
  it('is 0 for an unknown transaction', () => {
    expect(owedBackArs('nope', {}, BLUE)).toBe(0);
  });
});

describe('shareForExpense', () => {
  it('everyone → full amount (USD normalised)', () => {
    expect(shareForExpense(exp({ amount: 5, currency: 'USD' }), 'everyone', ctx())).toBe(5000);
  });

  it('household → full when scope is household, 0 otherwise', () => {
    expect(shareForExpense(exp({ scope: 'household', amount: 800 }), 'household', ctx())).toBe(800);
    expect(shareForExpense(exp({ scope: 'personal', amount: 800 }), 'household', ctx())).toBe(0);
  });

  it('person lens, personal expense → full if theirs, 0 if not', () => {
    expect(shareForExpense(exp({ profile_id: ME, amount: 700 }), ME, ctx())).toBe(700);
    expect(shareForExpense(exp({ profile_id: PARTNER, amount: 700 }), ME, ctx())).toBe(0);
  });

  it('person lens, shared expense → their ower split share', () => {
    const t = exp({
      profile_id: PARTNER, is_shared: true, scope: 'household', amount: 1000,
      splits: [{ payer_profile_id: PARTNER, ower_profile_id: ME, amount: 400 }],
    });
    expect(shareForExpense(t, ME, ctx())).toBe(400);
  });

  it('person lens, shared expense they paid → total minus what is owed to them', () => {
    const t = exp({
      profile_id: ME, is_shared: true, scope: 'household', amount: 1000,
      splits: [{ payer_profile_id: ME, ower_profile_id: PARTNER, amount: 400 }],
    });
    expect(shareForExpense(t, ME, ctx())).toBe(600); // 1000 - 400
  });

  it('nets out a friend repayment (linked owed debt), never going negative', () => {
    const t = exp({ profile_id: ME, amount: 1000 });
    const c = ctx({ debtByTx: { tx1: [{ transaction_id: 'tx1', direction: 'owed', amount: 300, currency: 'ARS' }] } });
    expect(shareForExpense(t, ME, c)).toBe(700);

    const big = ctx({ debtByTx: { tx1: [{ transaction_id: 'tx1', direction: 'owed', amount: 5000, currency: 'ARS' }] } });
    expect(shareForExpense(t, ME, big)).toBe(0); // clamped, not negative
  });
});

describe('lensFraction', () => {
  function parent(over: Partial<ItemParent> = {}): ItemParent {
    return {
      occurred_on: '2026-06-01', currency: 'ARS', usd_rate_snapshot: null,
      scope: 'personal', is_shared: false, profile_id: ME, amount: 1000, splits: null, ...over,
    };
  }
  it('everyone → 1, household depends on scope', () => {
    expect(lensFraction(parent(), 'everyone', BLUE)).toBe(1);
    expect(lensFraction(parent({ scope: 'household' }), 'household', BLUE)).toBe(1);
    expect(lensFraction(parent({ scope: 'personal' }), 'household', BLUE)).toBe(0);
  });

  it('is consistent with shareForExpense for the same shared split', () => {
    const shared = {
      is_shared: true, scope: 'household', amount: 1000,
      splits: [{ payer_profile_id: PARTNER, ower_profile_id: ME, amount: 400 }],
    };
    const frac = lensFraction(parent({ profile_id: PARTNER, ...shared }), ME, BLUE);
    const share = shareForExpense(exp({ profile_id: PARTNER, ...shared }), ME, ctx());
    // fraction * total === absolute share
    expect(frac * 1000).toBeCloseTo(share, 6);
    expect(frac).toBeCloseTo(0.4, 6);
  });
});

describe('MONTHLY multipliers', () => {
  it('maps cadences to monthly equivalents', () => {
    expect(MONTHLY.monthly).toBe(1);
    expect(MONTHLY.biweekly).toBe(2.17);
    expect(MONTHLY.weekly).toBe(4.345);
    expect(MONTHLY.unknown).toBeUndefined();
  });
});

describe('jwtPayload', () => {
  it('decodes a base64url JWT payload', () => {
    const payload = { role: 'service_role', sub: 'abc' };
    const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const token = `header.${b64}.sig`;
    expect(jwtPayload(token)).toEqual(payload);
  });
  it('returns null on garbage instead of throwing', () => {
    expect(jwtPayload('not-a-jwt')).toBeNull();
    expect(jwtPayload('')).toBeNull();
  });
});

describe('iso', () => {
  it('formats Y/M(0-based)/D to YYYY-MM-DD', () => {
    expect(iso(2026, 5, 22)).toBe('2026-06-22');
  });
});

describe('buildPrimer', () => {
  it('names the asker, partner and categories', () => {
    const primer = buildPrimer({
      blue: BLUE, pm: { [ME]: 'Lucas', [PARTNER]: 'Sofi' },
      askerId: ME, partnerId: PARTNER, catNames: 'Súper, Delivery',
    });
    expect(primer).toContain('Quien te escribe es Lucas. Su pareja es Sofi.');
    expect(primer).toContain('Súper, Delivery');
    expect(primer).toContain('ARS');
  });
  it('falls back gracefully with no partner / no categories', () => {
    const primer = buildPrimer({ blue: BLUE, pm: { [ME]: 'Lucas' }, askerId: ME, partnerId: null, catNames: '' });
    expect(primer).toContain('su pareja');
    expect(primer).toContain('n/d');
  });
});
