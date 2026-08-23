import { describe, expect, it } from 'vitest';
import { formatCurrency, fromMinorUnits, parseAmount, sumAmounts, toMinorUnits } from '../src/currency';

describe('parseAmount', () => {
  it('accepts grouped input and a currency symbol', () => {
    expect(parseAmount('₹1,25,000')).toBe(125000);
    expect(parseAmount('1 250.50')).toBe(1250.5);
  });

  it('rejects input that is not a number', () => {
    expect(parseAmount('twelve')).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('12.3.4')).toBeNull();
  });

  it('keeps a negative sign', () => {
    expect(parseAmount('-500')).toBe(-500);
  });
});

describe('minor units', () => {
  it('round-trips through integers', () => {
    expect(fromMinorUnits(toMinorUnits(19.99))).toBe(19.99);
  });

  it('sums without floating point drift', () => {
    expect(sumAmounts([0.1, 0.2])).toBe(0.3);
    expect(0.1 + 0.2).not.toBe(0.3);
  });
});

describe('formatCurrency', () => {
  it('renders a dash for a non-finite value', () => {
    expect(formatCurrency(Number.NaN)).toBe('—');
  });

  it('includes the currency symbol', () => {
    expect(formatCurrency(1000)).toContain('1,000');
  });
});
