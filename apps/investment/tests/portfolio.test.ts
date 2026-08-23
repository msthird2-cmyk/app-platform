import { describe, expect, it } from 'vitest';
import { cagr, investedAmount, performance, summarize, unitsHeld, xirr, type Holding } from '../src/domain/portfolio';

function holding(overrides: Partial<Holding> = {}): Holding {
  return {
    id: 'h1',
    name: 'Index fund',
    kind: 'mutualFund',
    currentPrice: 120,
    transactions: [
      { id: 't1', units: 10, pricePerUnit: 100, date: new Date('2023-01-01T00:00:00Z') },
      { id: 't2', units: 10, pricePerUnit: 110, date: new Date('2023-07-01T00:00:00Z') },
    ],
    ...overrides,
  };
}

describe('holdings', () => {
  it('sums units across transactions', () => {
    expect(unitsHeld(holding())).toBe(20);
  });

  it('averages the cost basis over buys', () => {
    expect(investedAmount(holding())).toBe(2100);
  });

  it('reduces the basis proportionally on a sell', () => {
    const withSell = holding({
      transactions: [
        { id: 't1', units: 10, pricePerUnit: 100, date: new Date('2023-01-01T00:00:00Z') },
        { id: 't2', units: -5, pricePerUnit: 150, date: new Date('2023-06-01T00:00:00Z') },
      ],
    });
    expect(unitsHeld(withSell)).toBe(5);
    expect(investedAmount(withSell)).toBe(500);
  });

  it('computes gain and return', () => {
    const result = performance(holding());
    expect(result.currentValue).toBe(2400);
    expect(result.absoluteGain).toBe(300);
    expect(result.returnRatio).toBeCloseTo(300 / 2100);
  });

  it('reports a zero return rather than dividing by zero', () => {
    const sold = holding({ transactions: [] });
    expect(performance(sold).returnRatio).toBe(0);
  });
});

describe('summarize', () => {
  it('aggregates across holdings', () => {
    const summary = summarize([holding(), holding({ id: 'h2', currentPrice: 90 })]);
    expect(summary.holdings).toBe(2);
    expect(summary.invested).toBe(4200);
    expect(summary.currentValue).toBe(2400 + 1800);
  });

  it('handles an empty portfolio', () => {
    expect(summarize([])).toEqual({
      invested: 0,
      currentValue: 0,
      absoluteGain: 0,
      returnRatio: 0,
      holdings: 0,
    });
  });
});

describe('xirr', () => {
  it('finds a simple annual return', () => {
    const rate = xirr([
      { amount: -1000, date: new Date('2023-01-01T00:00:00Z') },
      { amount: 1100, date: new Date('2024-01-01T00:00:00Z') },
    ]);
    expect(rate).toBeCloseTo(0.1, 2);
  });

  it('handles irregular cash flows', () => {
    const rate = xirr([
      { amount: -1000, date: new Date('2023-01-01T00:00:00Z') },
      { amount: -500, date: new Date('2023-06-15T00:00:00Z') },
      { amount: 1700, date: new Date('2024-03-01T00:00:00Z') },
    ]);
    expect(rate).not.toBeNull();
    expect(rate!).toBeGreaterThan(0);
  });

  it('returns null when there is no sign change to solve for', () => {
    expect(
      xirr([
        { amount: -100, date: new Date('2023-01-01T00:00:00Z') },
        { amount: -100, date: new Date('2024-01-01T00:00:00Z') },
      ]),
    ).toBeNull();
    expect(xirr([{ amount: -100, date: new Date('2023-01-01T00:00:00Z') }])).toBeNull();
  });

  it('solves a loss', () => {
    const rate = xirr([
      { amount: -1000, date: new Date('2023-01-01T00:00:00Z') },
      { amount: 900, date: new Date('2024-01-01T00:00:00Z') },
    ]);
    expect(rate).toBeCloseTo(-0.1, 2);
  });
});

describe('cagr', () => {
  it('computes compound growth', () => {
    expect(cagr(100, 121, 2)).toBeCloseTo(0.1);
  });

  it('refuses impossible inputs', () => {
    expect(cagr(0, 100, 2)).toBeNull();
    expect(cagr(100, 121, 0)).toBeNull();
  });
});
