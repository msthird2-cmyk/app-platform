import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme, spacing, radius, typography } from '@platform/theme';
import { AppText } from './AppText';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  /** Error code already mapped to copy by the application. */
  error?: string | null;
  hint?: string;
}

export function TextField({ label, error, hint, ...props }: TextFieldProps) {
  const theme = useTheme();
  return (
    <View style={styles.container}>
      <AppText variant="label" tone="muted">
        {label.toUpperCase()}
      </AppText>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.colors.textMuted}
        {...props}
        style={[
          styles.input,
          {
            backgroundColor: theme.colors.surface,
            borderColor: error ? theme.colors.down : theme.colors.border,
            color: theme.colors.text,
          },
        ]}
      />
      {error ? (
        <AppText variant="meta" tone="down">
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="meta" tone="muted">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: typography.body.fontSize,
  },
});
