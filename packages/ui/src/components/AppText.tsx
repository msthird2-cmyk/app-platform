import { Text, type TextProps, type TextStyle } from 'react-native';
import { useTheme, typography, type TypographyVariant } from '@platform/theme';

export interface AppTextProps extends TextProps {
  variant?: TypographyVariant;
  tone?: 'default' | 'muted' | 'accent' | 'up' | 'down' | 'warn' | 'inverted';
  /** Figures use tabular numerals so columns line up. */
  numeric?: boolean;
}

export function AppText({
  variant = 'body',
  tone = 'default',
  numeric = false,
  style,
  ...props
}: AppTextProps) {
  const theme = useTheme();
  const toneColor: Record<NonNullable<AppTextProps['tone']>, string> = {
    default: theme.colors.text,
    muted: theme.colors.textMuted,
    accent: theme.colors.accent,
    up: theme.colors.up,
    down: theme.colors.down,
    warn: theme.colors.warn,
    inverted: theme.colors.textInverted,
  };
  const base: TextStyle = {
    fontSize: typography[variant].fontSize,
    fontWeight: typography[variant].fontWeight as TextStyle['fontWeight'],
    color: toneColor[tone],
  };
  if (numeric) base.fontVariant = ['tabular-nums'];
  return <Text {...props} style={[base, style]} />;
}
