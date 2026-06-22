import { describe, it, expect } from 'vitest';
import { normalize, isDuplicate, type ExistingTx } from './math.ts';

describe('normalize', () => {
  it('lowercases and strips non-alphanumerics', () => {
    expect(normalize('MercadoPago *Uber')).toBe('mercadopagouber');
  });
});

describe('isDuplicate', () => {
  const existing: ExistingTx[] = [
    { occurred_on: '2026-06-10', amount: 5000, merchant: 'Cafe Martinez' },
  ];
  it('flags a same-day, same-amount, fuzzy-merchant match', () => {
    expect(isDuplicate({ date: '2026-06-10', amount: 5000, merchant: 'cafe martinez' }, existing)).toBe(true);
    expect(isDuplicate({ date: '2026-06-10', amount: 5001, merchant: 'Martinez' }, existing)).toBe(true); // ≤1 amount diff, contains
  });
  it('is not a duplicate on a different date or amount', () => {
    expect(isDuplicate({ date: '2026-06-11', amount: 5000, merchant: 'Cafe Martinez' }, existing)).toBe(false);
    expect(isDuplicate({ date: '2026-06-10', amount: 9999, merchant: 'Cafe Martinez' }, existing)).toBe(false);
  });
  it('does NOT suppress when either merchant is empty (two SUBE top-ups)', () => {
    const sube: ExistingTx[] = [{ occurred_on: '2026-06-10', amount: 5000, merchant: '' }];
    expect(isDuplicate({ date: '2026-06-10', amount: 5000, merchant: '' }, sube)).toBe(false);
  });
});
