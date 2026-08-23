import { describe, expect, it } from 'vitest';
import { buildTheme, palette, spacing, typography } from '../src/tokens';
import { resolveScheme } from '../src/scheme';

describe('resolveScheme', () => {
  it('follows the system when the preference is system', () => {
    expect(resolveScheme('system', 'dark')).toBe('dark');
    expect(resolveScheme('system', 'light')).toBe('light');
  });

  it('overrides the system for an explicit preference', () => {
    expect(resolveScheme('light', 'dark')).toBe('light');
    expect(resolveScheme('dark', 'light')).toBe('dark');
  });
});

describe('tokens', () => {
  it('defines the same colour keys in both schemes', () => {
    expect(Object.keys(palette.light).sort()).toEqual(Object.keys(palette.dark).sort());
  });

  it('never drops below the 12px minimum', () => {
    for (const step of Object.values(typography)) expect(step.fontSize).toBeGreaterThanOrEqual(12);
  });

  it('builds a theme carrying every token group', () => {
    const theme = buildTheme('dark');
    expect(theme.colors).toBe(palette.dark);
    expect(theme.spacing).toBe(spacing);
  });
});
