export interface CurrencyOptions {
  currency?: string;
  locale?: string;
  maximumFractionDigits?: number;
  compact?: boolean;
}

const DEFAULTS = { currency: 'INR', locale: 'en-IN' } as const;

export function formatCurrency(amount: number, options: CurrencyOptions = {}): string {
  const { currency = DEFAULTS.currency, locale = DEFAULTS.locale, compact = false } = options;
  if (!Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: options.maximumFractionDigits ?? (compact ? 1 : 0),
  }).format(amount);
}

/**
 * Parses user input into a number. Accepts grouping separators and a leading
 * currency symbol; rejects anything else rather than guessing.
 */
export function parseAmount(input: string): number | null {
  // \u00a0 and \u202f are the non-breaking spaces Intl uses as group separators.
  const cleaned = input.replace(/[\s,\u00a0\u202f]/g, '').replace(/^[^\d.\-+]+/, '');
  if (cleaned.length === 0) return null;
  if (!/^[-+]?\d*\.?\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** Money is compared in minor units to keep float error out of equality checks. */
export function toMinorUnits(amount: number, precision = 2): number {
  return Math.round(amount * 10 ** precision);
}

export function fromMinorUnits(minor: number, precision = 2): number {
  return minor / 10 ** precision;
}

export function sumAmounts(amounts: readonly number[], precision = 2): number {
  const total = amounts.reduce((acc, value) => acc + toMinorUnits(value, precision), 0);
  return fromMinorUnits(total, precision);
}
