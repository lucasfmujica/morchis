import { describe, it, expect } from 'vitest';
import { occurrencesInRange, computeProjection, monthsBetween, normalize, type PRule, type PTx } from './math.ts';

const rule = (over: Partial<PRule> = {}): PRule => ({ direction: 'expense', amount: 1000, next_run: '2026-06-10', active: true, cadence: 'monthly', ...over });

describe('occurrencesInRange', () => {
  it('returns [] when there is no next_run', () => {
    expect(occurrencesInRange(rule({ next_run: null }), '2026-06-01', '2026-06-30')).toEqual([]);
  });
  it('counts a monthly rule once in a month window', () => {
    expect(occurrencesInRange(rule({ cadence: 'monthly' }), '2026-06-01', '2026-06-30')).toEqual(['2026-06-10']);
  });
  it('expands a weekly rule across the rest of the month', () => {
    // from exclusive 2026-06-09, anchor 06-10 then +7 each
    expect(occurrencesInRange(rule({ cadence: 'weekly', next_run: '2026-06-10' }), '2026-06-09', '2026-06-30'))
      .toEqual(['2026-06-10', '2026-06-17', '2026-06-24']);
  });
  it('expands a biweekly rule', () => {
    expect(occurrencesInRange(rule({ cadence: 'biweekly', next_run: '2026-06-02' }), '2026-06-01', '2026-06-30'))
      .toEqual(['2026-06-02', '2026-06-16', '2026-06-30']);
  });
  it('excludes the fromExclusive boundary and includes toInclusive', () => {
    expect(occurrencesInRange(rule({ cadence: 'weekly', next_run: '2026-06-10' }), '2026-06-10', '2026-06-17'))
      .toEqual(['2026-06-17']); // 06-10 excluded (== from), 06-17 included (== to)
  });
});

describe('computeProjection', () => {
  it('projects balance from month-to-date spend + remaining fixed/income', () => {
    const today = new Date(Date.UTC(2026, 5, 15)); // 15 Jun 2026, 30-day month
    const txs: PTx[] = [
      { type: 'income', amount: 100000, occurred_on: '2026-06-01' },
      { type: 'expense', amount: 30000, occurred_on: '2026-06-10' },
    ];
    // income rule already fired (next_run before today) → not counted as remaining
    const rules: PRule[] = [{ direction: 'expense', amount: 5000, next_run: '2026-06-20', active: true, cadence: 'monthly' }];
    const r = computeProjection(txs, rules, today);
    expect(r.expensesSoFar).toBe(30000);
    // currentBalance 70000; dailyRate 30000/15=2000; daysRemaining 15 → projVar 30000
    // remainingFixed = 5000 (one occurrence on 06-20); remainingIncome 0
    expect(r.projectedBalance).toBe(70000 - 5000 - 30000);
    expect(r.totalIncome).toBe(100000);
  });
});

describe('monthsBetween', () => {
  it('counts calendar months between two dates', () => {
    expect(monthsBetween(new Date(2026, 0, 1), new Date(2026, 5, 1))).toBe(5);
    expect(monthsBetween(new Date(2025, 11, 1), new Date(2026, 1, 1))).toBe(2);
  });
});

describe('normalize', () => {
  it('strips accents, case and punctuation', () => {
    expect(normalize('Café-Martínez 24!')).toBe('cafemartinez24');
  });
});
