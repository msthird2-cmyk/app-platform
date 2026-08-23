import { StyleSheet, View } from 'react-native';
import { useTheme, radius } from '@platform/theme';

export interface ProgressBarProps {
  /** 0…1. Values outside the range are clamped. */
  progress: number;
  tone?: 'accent' | 'up' | 'down' | 'warn';
  label?: string;
}

export function ProgressBar({ progress, tone = 'accent', label }: ProgressBarProps) {
  const theme = useTheme();
  const clamped = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  const toneColor = {
    accent: theme.colors.accent,
    up: theme.colors.up,
    down: theme.colors.down,
    warn: theme.colors.warn,
  }[tone];

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ now: Math.round(clamped * 100), min: 0, max: 100 }}
      style={[styles.track, { backgroundColor: theme.colors.surfaceMuted }]}
    >
      <View style={[styles.fill, { backgroundColor: toneColor, width: `${clamped * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 6, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },
});
