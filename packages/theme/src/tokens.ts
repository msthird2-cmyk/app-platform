/**
 * Design tokens. Every colour, space and type step used anywhere in the
 * platform comes from here — packages and apps never define their own.
 */
export const spacing = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  none: 0,
  sm: 6,
  md: 12,
  lg: 20,
  pill: 999,
} as const;

export const typography = {
  label: { fontSize: 12, fontWeight: '600' },
  meta: { fontSize: 13, fontWeight: '500' },
  body: { fontSize: 15, fontWeight: '500' },
  title: { fontSize: 18, fontWeight: '700' },
  hero: { fontSize: 34, fontWeight: '800' },
} as const;

export type TypographyVariant = keyof typeof typography;

export const palette = {
  light: {
    background: '#F6F6F9',
    surface: '#FFFFFF',
    surfaceMuted: '#EFEFF5',
    border: '#DEDEE8',
    text: '#14141C',
    textMuted: '#5A5A6B',
    textInverted: '#FFFFFF',
    accent: '#4F46E5',
    accentMuted: '#E4E2FB',
    up: '#12805C',
    down: '#B3261E',
    warn: '#8A5A00',
    overlay: 'rgba(20, 20, 28, 0.45)',
  },
  dark: {
    background: '#101017',
    surface: '#191922',
    surfaceMuted: '#232330',
    border: '#33333F',
    text: '#F3F3F7',
    textMuted: '#A2A2B4',
    textInverted: '#14141C',
    accent: '#A5A0FF',
    accentMuted: '#2B2846',
    up: '#5BD6A8',
    down: '#FF9C93',
    warn: '#F0BE5A',
    overlay: 'rgba(0, 0, 0, 0.6)',
  },
} as const;

export type ColorScheme = 'light' | 'dark';
export type Colors = { readonly [K in keyof (typeof palette)['light']]: string };

export interface Theme {
  scheme: ColorScheme;
  colors: Colors;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
}

export function buildTheme(scheme: ColorScheme): Theme {
  return { scheme, colors: palette[scheme], spacing, radius, typography };
}
