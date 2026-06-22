import { describe, it, expect } from 'vitest';
import {
  toArs, myShareArs, expenseShareArs, assetBalance, onBudgetCashArs,
  activityByCategoryMonth, availableByCategory, readyToAssign,
  type Tx, type Account, type Assignment,
} from './math.ts';

const RATE = 1000;
const ME = 'me', PARTNER = 'partner';

function tx(over: Partial<Tx> = {}): Tx {
  return {
    id: 't', type: 'expense', category_id: 'cat', amount: 1000, currency: 'ARS',
    scope: 'personal', profile_id: ME, is_shared: false, occurred_on: '2026-06-10',
    account_id: 'acc', transfer_account_id: null, splits: null, ...over,
  };
}

describe('toArs', () => {
  it('rounds USD via rate, passes ARS', () => {
    expect(toArs(10, 'USD', RATE)).toBe(10000);
    expect(toArs(1234, 'ARS', RATE)).toBe(1234);
    expect(toArs(10, 'USD', 0)).toBe(10); // no rate → passthrough
  });
});

describe('myShareArs', () => {
  it('full amount when not shared', () => {
    expect(myShareArs(tx({ is_shared: false, amount: 800 }), ME, RATE)).toBe(800);
  });
  it('the ower split when shared', () => {
    const t = tx({ is_shared: true, amount: 1000, splits: [{ payer_profile_id: PARTNER, ower_profile_id: ME, amount: 400 }] });
    expect(myShareArs(t, ME, RATE)).toBe(400);
  });
  it('payer keeps total minus what is owed to them', () => {
    const t = tx({ is_shared: true, profile_id: ME, amount: 1000, splits: [{ payer_profile_id: ME, ower_profile_id: PARTNER, amount: 400 }] });
    expect(myShareArs(t, ME, RATE)).toBe(600);
  });
});

describe('expenseShareArs', () => {
  it('nets a receivable and never goes negative', () => {
    expect(expenseShareArs(tx({ amount: 1000 }), ME, RATE, 300)).toBe(700);
    expect(expenseShareArs(tx({ amount: 1000 }), ME, RATE, 5000)).toBe(0);
  });
});

describe('assetBalance', () => {
  it('adds income, subtracts expense/transfer-out, adds transfer-in, ignores future', () => {
    const rows: Tx[] = [
      tx({ type: 'income', amount: 1000, account_id: 'a' }),
      tx({ type: 'expense', amount: 300, account_id: 'a' }),
      tx({ type: 'transfer', amount: 200, account_id: 'a', transfer_account_id: 'b' }),
      tx({ type: 'transfer', amount: 50, account_id: 'b', transfer_account_id: 'a' }),
      tx({ type: 'income', amount: 9999, account_id: 'a', occurred_on: '2999-01-01' }), // future, ignored
    ];
    // 100 initial + 1000 - 300 - 200 (out) + 50 (in) = 650
    expect(assetBalance(rows, 'a', 100, '2026-12-31')).toBe(650);
  });
});

describe('onBudgetCashArs', () => {
  it('sums on-budget asset accounts owned by the person, excluding credit/archived', () => {
    const accounts: Account[] = [
      { id: 'a', type: 'checking', currency: 'ARS', archived: false, initial_balance: 1000, owner_profile_id: ME, on_budget: true, payment_category_id: null },
      { id: 'b', type: 'credit', currency: 'ARS', archived: false, initial_balance: 5000, owner_profile_id: ME, on_budget: true, payment_category_id: null },
      { id: 'c', type: 'checking', currency: 'ARS', archived: false, initial_balance: 999, owner_profile_id: PARTNER, on_budget: true, payment_category_id: null },
    ];
    expect(onBudgetCashArs(accounts, [], ME, '2026-12-31', RATE)).toBe(1000);
  });
});

describe('activity / available / readyToAssign', () => {
  it('builds envelope availability and ready-to-assign', () => {
    const rows: Tx[] = [
      tx({ id: 't1', category_id: 'food', amount: 1200, occurred_on: '2026-06-05' }),
    ];
    const activity = activityByCategoryMonth(rows, ME, RATE, new Map(), new Map());
    expect(activity.get('food__2026-06')).toBe(1200);

    const assignments: Assignment[] = [{ profile_id: ME, category_id: 'food', month: '2026-06', assigned: 2000, currency: 'ARS' }];
    const available = availableByCategory(assignments, activity, '2026-06', RATE);
    expect(available.get('food')).toBe(800); // 2000 assigned - 1200 spent

    // cash 5000, funded envelopes 800 → RTA 4200
    expect(readyToAssign(5000, available)).toBe(4200);
  });

  it('readyToAssign ignores negative (overspent) envelopes when summing funded', () => {
    const available = new Map([['a', 1000], ['b', -500]]);
    expect(readyToAssign(3000, available)).toBe(2000); // only +1000 counts as funded
  });
});
