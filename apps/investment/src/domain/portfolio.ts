import { daysBetween } from '@platform/utils';

export type HoldingKind = 'equity' | 'mutualFund' | 'etf' | 'bond';

export interface Transaction {
  id: string;
  /** Positive for a buy, negative for a sell. */
  units: number;
  pricePerUnit: number;
  date: Date;
}

export interface Holding {
  id: string;
  name: string;
  kind: HoldingKind;
  transactions: readonly Transaction[];
  currentPrice: number;
}

export interface HoldingPerformance {
  units: number;
  invested: number;
  currentValue: number;
  absoluteGain: number;
  /** Simple return as a fraction: 0.12 is +12%. */
  returnRatio: number;
}

export function unitsHeld(holding: Holding): number {
  return holding.transactions.reduce((sum, transaction) => sum + transaction.units, 0);
}

/**
 * Cost basis of the units still held, averaged over buys. Sells reduce the
 * basis proportionally rather than being matched to a specific lot.
 */
export function investedAmount(holding: Holding): number {
  let units = 0;
  let cost = 0;
  for (const transaction of holding.transactions) {
    if (transaction.units >= 0) {
      units += transaction.units;
      cost += transaction.units * transaction.pricePerUnit;
    } else {
      const averageCost = units === 0 ? 0 : cost / units;
      const sold = Math.min(units, -transaction.units);
      units -= sold;
      cost -= sold * averageCost;
    }
  }
  return cost;
}

export function performance(holding: Holding): HoldingPerformance {
  const units = unitsHeld(holding);
  const invested = investedAmount(holding);
  const currentValue = units * holding.currentPrice;
  const absoluteGain = currentValue - invested;
  return {
    units,
    invested,
    currentValue,
    absoluteGain,
    returnRatio: invested === 0 ? 0 : absoluteGain / invested,
  };
}

export interface PortfolioSummary {
  invested: number;
  currentValue: number;
  absoluteGain: number;
  returnRatio: number;
  holdings: number;
}

export function summarize(holdings: readonly Holding[]): PortfolioSummary {
  const totals = holdings.reduce(
    (acc, holding) => {
      const result = performance(holding);
      return { invested: acc.invested + result.invested, currentValue: acc.currentValue + result.currentValue };
    },
    { invested: 0, currentValue: 0 },
  );
  const absoluteGain = totals.currentValue - totals.invested;
  return {
    ...totals,
    absoluteGain,
    returnRatio: totals.invested === 0 ? 0 : absoluteGain / totals.invested,
    holdings: holdings.length,
  };
}

export interface CashFlow {
  amount: number;
  date: Date;
}

function netPresentValue(rate: number, flows: readonly CashFlow[], start: Date): number {
  return flows.reduce((sum, flow) => {
    const years = daysBetween(start, flow.date) / 365;
    return sum + flow.amount / (1 + rate) ** years;
  }, 0);
}

/**
 * Money-weighted return. Bisection rather than Newton–Raphson: slower, but it
 * cannot diverge on the irregular cash flows a real portfolio produces.
 */
export function xirr(flows: readonly CashFlow[], tolerance = 1e-7, maxIterations = 200): number | null {
  if (flows.length < 2) return null;
  const sorted = [...flows].sort((a, b) => a.date.getTime() - b.date.getTime());
  const start = sorted[0]!.date;
  const hasInflow = sorted.some((flow) => flow.amount > 0);
  const hasOutflow = sorted.some((flow) => flow.amount < 0);
  if (!hasInflow || !hasOutflow) return null;

  let low = -0.9999;
  let high = 10;
  let lowValue = netPresentValue(low, sorted, start);
  let highValue = netPresentValue(high, sorted, start);
  if (lowValue * highValue > 0) return null;

  for (let i = 0; i < maxIterations; i += 1) {
    const mid = (low + high) / 2;
    const midValue = netPresentValue(mid, sorted, start);
    if (Math.abs(midValue) < tolerance) return mid;
    if (lowValue * midValue < 0) {
      high = mid;
      highValue = midValue;
    } else {
      low = mid;
      lowValue = midValue;
    }
  }
  return (low + high) / 2;
}

/** Compound annual growth rate between two values held over `years`. */
export function cagr(initial: number, final: number, years: number): number | null {
  if (initial <= 0 || years <= 0) return null;
  return (final / initial) ** (1 / years) - 1;
}
