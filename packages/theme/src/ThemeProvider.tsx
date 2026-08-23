import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Appearance } from 'react-native';
import { buildTheme, type ColorScheme, type Theme } from './tokens';
import { resolveScheme, type ThemePreference } from './scheme';

export type { ThemePreference };

export interface ThemeContextValue {
  theme: Theme;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  children: ReactNode;
  /** Initial preference, usually restored from persisted settings by the app. */
  initialPreference?: ThemePreference;
  onPreferenceChange?: (preference: ThemePreference) => void;
}

export function ThemeProvider({
  children,
  initialPreference = 'system',
  onPreferenceChange,
}: ThemeProviderProps) {
  const [preference, setPreferenceState] = useState<ThemePreference>(initialPreference);
  const [systemScheme, setSystemScheme] = useState<ColorScheme>(
    Appearance.getColorScheme() === 'dark' ? 'dark' : 'light',
  );

  useEffect(() => {
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemScheme(colorScheme === 'dark' ? 'dark' : 'light');
    });
    return () => subscription.remove();
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const setPreference = (next: ThemePreference): void => {
      setPreferenceState(next);
      onPreferenceChange?.(next);
    };
    return {
      theme: buildTheme(resolveScheme(preference, systemScheme)),
      preference,
      setPreference,
    };
  }, [preference, systemScheme, onPreferenceChange]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeContext(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('THEME_PROVIDER_MISSING');
  return context;
}

export function useTheme(): Theme {
  return useThemeContext().theme;
}
