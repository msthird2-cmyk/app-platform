import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTheme, spacing } from '@platform/theme';
import { AppText } from './AppText';

export interface LoadingProps {
  label?: string;
}

export function Loading({ label }: LoadingProps) {
  const theme = useTheme();
  return (
    <View style={styles.container}>
      <ActivityIndicator color={theme.colors.accent} />
      {label ? (
        <AppText variant="meta" tone="muted">
          {label}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
});
