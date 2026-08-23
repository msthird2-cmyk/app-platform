import { describe, expect, it } from 'vitest';
import {
  allocationByCategory,
  computeNetWorth,
  debtToAssetRatio,
  netWorthChange,
  totalAssets,
  type Asset,
  type Liability,
} from '../src/domain/assets';

const assets: Asset[] = [
  { id: '1', name: 'Savings', category: 'cash', value: 200000, includeInNetWorth: true },
  { id: '2', name: 'Index fund', category: 'mutualFunds', value: 800000, includeInNetWorth: true },
  { id: '3', name: 'Spouse flat', category: 'property', value: 5000000, includeInNetWorth: false },
];

const liabilities: Liability[] = [
  { id: 'l1', name: 'Home loan', category: 'homeLoan', outstanding: 300000 },
];

describe('computeNetWorth', () => {
  it('excludes assets flagged out of the total', () => {
    expect(totalAssets(assets)).toBe(1000000);
  });

  it('subtracts liabilities', () => {
    expect(computeNetWorth(assets, liabilities)).toEqual({
      assets: 1000000,
      liabilities: 300000,
      net: 700000,
    });
  });

  it('handles an empty portfolio without dividing by zero', () => {
    const empty = computeNetWorth([], []);
    expect(empty.net).toBe(0);
    expect(debtToAssetRatio(empty)).toBe(0);
  });

  it('goes negative when debts exceed assets', () => {
    const result = computeNetWorth(assets, [
      { id: 'l', name: 'Loan', category: 'personalLoan', outstanding: 1500000 },
    ]);
    expect(result.net).toBe(-500000);
  });
});

describe('allocationByCategory', () => {
  it('sorts by value and shares sum to one', () => {
    const allocation = allocationByCategory(assets);
    expect(allocation.map((entry) => entry.category)).toEqual(['mutualFunds', 'cash']);
    expect(allocation.reduce((sum, entry) => sum + entry.share, 0)).toBeCloseTo(1);
  });

  it('merges several assets in one category', () => {
    const allocation = allocationByCategory([
      ...assets,
      { id: '4', name: 'Emergency', category: 'cash', value: 100000, includeInNetWorth: true },
    ]);
    expect(allocation.find((entry) => entry.category === 'cash')?.value).toBe(300000);
  });

  it('returns nothing for an empty list', () => {
    expect(allocationByCategory([])).toEqual([]);
  });
});

describe('netWorthChange', () => {
  it('reports absolute and relative change', () => {
    expect(netWorthChange(500000, 700000)).toEqual({ absolute: 200000, ratio: 0.4 });
  });

  it('handles growth from a negative starting point', () => {
    expect(netWorthChange(-100000, -50000)).toEqual({ absolute: 50000, ratio: 0.5 });
  });

  it('avoids dividing by zero', () => {
    expect(netWorthChange(0, 1000)).toEqual({ absolute: 1000, ratio: 0 });
  });
});
