export function formatNumber(value: number, locale = 'en-IN', maximumFractionDigits = 2): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value);
}

/** `ratio` is a fraction: 0.1234 renders as 12.3%. */
export function formatPercent(ratio: number, fractionDigits = 1, locale = 'en-IN'): string {
  if (!Number.isFinite(ratio)) return '—';
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(ratio);
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/(^|\s|-)([a-z])/g, (_match, lead: string, letter: string) => lead + letter.toUpperCase());
}
