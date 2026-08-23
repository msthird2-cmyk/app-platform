import { describe, expect, it } from 'vitest';
import {
  averageMonthlySpend,
  budgetStatus,
  categorize,
  expensesForMonth,
  monthlyTotals,
  type Expense,
} from '../src/domain/expenses';

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'e1',
    description: 'Swiggy order',
    amount: 450,
    category: 'dining',
    date: new Date('2024-03-05T00:00:00Z'),
    ...overrides,
  };
}

describe('categorize', () => {
  it('matches a keyword regardless of case', () => {
    expect(categorize('SWIGGY INSTAMART')).toBe('dining');
    expect(categorize('Uber trip')).toBe('transport');
  });

  it('prefers the longer keyword over rule order', () => {
    const rules = [
      { keyword: 'basket', category: 'other' as const },
      { keyword: 'bigbasket', category: 'groceries' as const },
    ];
    expect(categorize('BigBasket weekly', rules)).toBe('groceries');
    expect(categorize('BigBasket weekly', [...rules].reverse())).toBe('groceries');
  });

  it('falls back to other', () => {
    expect(categorize('Unlabelled payment')).toBe('other');
  });
});

describe('budgetStatus', () => {
  const expenses = [expense({ amount: 4000 }), expense({ id: 'e2', amount: 1000 })];

  it('reports usage under the limit', () => {
    const status = budgetStatus({ category: 'dining', monthlyLimit: 10000 }, expenses);
    expect(status.spent).toBe(5000);
    expect(status.remaining).toBe(5000);
    expect(status.state).toBe('under');
  });

  it('warns at 80 percent', () => {
    expect(budgetStatus({ category: 'dining', monthlyLimit: 6000 }, expenses).state).toBe('near');
  });

  it('reports going over', () => {
    const status = budgetStatus({ category: 'dining', monthlyLimit: 4000 }, expenses);
    expect(status.state).toBe('over');
    expect(status.remaining).toBe(-1000);
  });

  it('does not divide by a zero limit', () => {
    expect(budgetStatus({ category: 'dining', monthlyLimit: 0 }, expenses).usage).toBe(0);
  });
});

describe('monthly analytics', () => {
  const expenses = [
    expense({ id: 'a', amount: 100, date: new Date('2024-01-10T00:00:00Z') }),
    expense({ id: 'b', amount: 300, date: new Date('2024-02-10T00:00:00Z') }),
    expense({ id: 'c', amount: 50, date: new Date('2024-03-02T00:00:00Z') }),
  ];

  it('filters to one month', () => {
    expect(expensesForMonth(expenses, new Date('2024-02-20T00:00:00Z')).map((e) => e.id)).toEqual(['b']);
  });

  it('totals each month in order', () => {
    expect(monthlyTotals(expenses)).toEqual([
      { month: '2024-01', total: 100 },
      { month: '2024-02', total: 300 },
      { month: '2024-03', total: 50 },
    ]);
  });

  it('excludes the partial current month from the average', () => {
    expect(averageMonthlySpend(expenses, new Date('2024-03-15T00:00:00Z'))).toBe(200);
  });

  it('returns zero when only the current month has data', () => {
    expect(averageMonthlySpend([expenses[2]!], new Date('2024-03-15T00:00:00Z'))).toBe(0);
  });
});
