import { describe, expect, it } from 'vitest';
import { addMonths, daysBetween, endOfMonth, monthKey, monthsBetween, startOfMonth, toIsoDate, fromIsoDate } from '../src/dates';

describe('addMonths', () => {
  it('clamps to the last day of a shorter month', () => {
    expect(toIsoDate(addMonths(new Date('2024-01-31T00:00:00Z'), 1))).toBe('2024-02-29');
    expect(toIsoDate(addMonths(new Date('2023-01-31T00:00:00Z'), 1))).toBe('2023-02-28');
  });

  it('walks backwards', () => {
    expect(toIsoDate(addMonths(new Date('2024-03-15T00:00:00Z'), -3))).toBe('2023-12-15');
  });
});

describe('month boundaries', () => {
  it('finds the start and end of a month', () => {
    const date = new Date('2024-02-14T10:00:00Z');
    expect(toIsoDate(startOfMonth(date))).toBe('2024-02-01');
    expect(toIsoDate(endOfMonth(date))).toBe('2024-02-29');
  });

  it('counts months across a year boundary', () => {
    expect(monthsBetween(new Date('2023-11-01T00:00:00Z'), new Date('2024-02-01T00:00:00Z'))).toBe(3);
  });
});

describe('iso dates', () => {
  it('rejects malformed input', () => {
    expect(fromIsoDate('14-02-2024')).toBeNull();
    expect(fromIsoDate('2024-13-01')).toBeNull();
  });

  it('produces a stable month key', () => {
    expect(monthKey(new Date('2024-07-04T00:00:00Z'))).toBe('2024-07');
  });

  it('counts days', () => {
    expect(daysBetween(new Date('2024-01-01T00:00:00Z'), new Date('2024-01-31T00:00:00Z'))).toBe(30);
  });
});
