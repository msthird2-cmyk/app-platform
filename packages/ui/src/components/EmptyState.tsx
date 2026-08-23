import { StyleSheet, View } from 'react-native';
import { spacing } from '@platform/theme';
import { AppText } from './AppText';
import { Button } from './Button';

export interface EmptyStateProps {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <AppText variant="title">{title}</AppText>
      {description ? (
        <AppText variant="body" tone="muted" style={styles.centered}>
          {description}
        </AppText>
      ) : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} fullWidth={false} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  centered: { textAlign: 'center' },
});
