import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useThemeContext, type ThemePreference } from './ThemeProvider';
import { spacing, radius, typography } from './tokens';

const OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export interface ThemeSelectorProps {
  label?: string;
}

export function ThemeSelector({ label = 'Appearance' }: ThemeSelectorProps) {
  const { theme, preference, setPreference } = useThemeContext();

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: theme.colors.textMuted }]}>{label.toUpperCase()}</Text>
      <View style={styles.row}>
        {OPTIONS.map((option) => {
          const selected = option.value === preference;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={option.label}
              onPress={() => setPreference(option.value)}
              style={[
                styles.option,
                {
                  backgroundColor: selected ? theme.colors.accent : theme.colors.surface,
                  borderColor: selected ? theme.colors.accent : theme.colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.optionLabel,
                  { color: selected ? theme.colors.textInverted : theme.colors.text },
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  label: { fontSize: typography.label.fontSize, fontWeight: '600', letterSpacing: 0.6 },
  row: { flexDirection: 'row', gap: spacing.sm },
  option: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  optionLabel: { fontSize: typography.body.fontSize, fontWeight: '600' },
});
