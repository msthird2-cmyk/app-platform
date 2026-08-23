import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme, spacing, radius } from '@platform/theme';
import { AppText } from './AppText';

export interface ListRowProps {
  title: string;
  meta?: string;
  value?: string;
  valueTone?: 'default' | 'up' | 'down' | 'muted';
  onPress?: () => void;
  testID?: string;
}

/**
 * A record row: name and headline value on the first line, secondary metadata
 * on the second. Never a horizontally scrolling table.
 */
export function ListRow({ title, meta, value, valueTone = 'default', onPress, testID }: ListRowProps) {
  const theme = useTheme();
  const content = (
    <View style={[styles.row, { backgroundColor: theme.colors.surface }]}>
      <View style={styles.labels}>
        <AppText variant="body" style={styles.title}>
          {title}
        </AppText>
        {meta ? (
          <AppText variant="meta" tone="muted">
            {meta}
          </AppText>
        ) : null}
      </View>
      {value ? (
        <AppText variant="body" tone={valueTone} numeric style={styles.value}>
          {value}
        </AppText>
      ) : null}
    </View>
  );

  if (!onPress) return content;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={title} onPress={onPress}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  labels: { flexShrink: 1, gap: 2 },
  title: { fontWeight: '600' },
  value: { fontWeight: '700' },
});
