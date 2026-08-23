import type { ColorScheme } from './tokens';

export type ThemePreference = 'system' | 'light' | 'dark';

/**
 * Pure so it can be unit-tested without a React Native runtime: importing
 * `react-native` pulls in Flow-typed source that a plain test runner cannot parse.
 */
export function resolveScheme(preference: ThemePreference, systemScheme: ColorScheme): ColorScheme {
  return preference === 'system' ? systemScheme : preference;
}
