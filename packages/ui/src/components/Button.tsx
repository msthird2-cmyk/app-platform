import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { useTheme, spacing, radius } from '@platform/theme';
import { AppText } from './AppText';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  accessibilityHint?: string;
  testID?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  fullWidth = true,
  accessibilityHint,
  testID,
}: ButtonProps) {
  const theme = useTheme();
  const inactive = disabled || loading;

  const background: Record<ButtonVariant, string> = {
    primary: theme.colors.accent,
    secondary: theme.colors.surface,
    danger: theme.colors.down,
    ghost: 'transparent',
  };
  const foreground: Record<ButtonVariant, 'inverted' | 'default' | 'down'> = {
    primary: 'inverted',
    secondary: 'default',
    danger: 'inverted',
    ghost: 'default',
  };

  const containerStyle: ViewStyle = {
    backgroundColor: background[variant],
    borderColor: variant === 'secondary' ? theme.colors.border : 'transparent',
    borderWidth: variant === 'secondary' ? 1 : 0,
    opacity: inactive ? 0.5 : 1,
    alignSelf: fullWidth ? 'stretch' : 'flex-start',
  };

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      accessibilityHint={accessibilityHint}
      disabled={inactive}
      onPress={onPress}
      style={[styles.button, containerStyle]}
    >
      <View style={styles.content}>
        {loading ? <ActivityIndicator color={theme.colors.textInverted} /> : null}
        <AppText variant="body" tone={foreground[variant]} style={styles.label}>
          {label}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
  },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  label: { fontWeight: '700' },
});
