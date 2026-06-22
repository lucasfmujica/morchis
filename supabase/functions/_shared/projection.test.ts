import { describe, it, expect } from 'vitest';
import { occurrencesInRange, computeProjection, type PTx, type PRule } from './projection.ts';

describe('occurrencesInRange', () => {
  it('expands weekly within the rest of the month', () => {
    const r: PRule = { direction: 'expense', amount: 1, next_run: '2026-06-10', active: true, cadence: 'weekly' };
    expect(occurrencesInRange(r, '2026-06-09', '2026-06-30')).toEqual(['2026-06-10', '2026-06-17', '2026-06-24']);
  });
  it('returns [] without a next_run', () => {
    expect(occurrencesInRange({ direction: 'income', amount: 1, next_run: null, active: true }, '2026-06-01', '2026-06-30')).toEqual([]);
  });
});

describe('computeProjection', () => {
  it('projects the end-of-month balance from MTD pace + remaining fixed/income', () => {
    const today = new Date(Date.UTC(2026, 5, 15)); // 15 Jun, 30-day month
    const txs: PTx[] = [
      { type: 'income', amount: 100000, occurred_on: '2026-06-01' },
      { type: 'expense', amount: 30000, occurred_on: '2026-06-10' },
    ];
    const rules: PRule[] = [{ direction: 'expense', amount: 5000, next_run: '2026-06-20', active: true, cadence: 'monthly' }];
    const p = computeProjection(txs, rules, today);
    expect(p.expensesSoFar).toBe(30000);
    expect(p.remainingFixed).toBe(5000);
    expect(p.projectedVariableSpend).toBe(30000); // (30000/15)*15
    expect(p.projectedBalance).toBe(70000 - 5000 - 30000);
    expect(p.totalIncome).toBe(100000);
  });
});
