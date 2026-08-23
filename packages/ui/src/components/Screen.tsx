import { ScrollView, StyleSheet, View, type ViewProps } from 'react-native';
import { useTheme, spacing } from '@platform/theme';
import { AppText } from './AppText';

export interface ScreenProps extends ViewProps {
  title?: string;
  subtitle?: string;
  scrollable?: boolean;
}

export function Screen({ title, subtitle, scrollable = true, children, style, ...props }: ScreenProps) {
  const theme = useTheme();
  const header =
    title || subtitle ? (
      <View style={styles.header}>
        {title ? <AppText variant="hero">{title}</AppText> : null}
        {subtitle ? (
          <AppText variant="meta" tone="muted">
            {subtitle}
          </AppText>
        ) : null}
      </View>
    ) : null;

  const body = (
    <View style={styles.body}>
      {header}
      {children}
    </View>
  );

  if (!scrollable) {
    return (
      <View {...props} style={[styles.screen, { backgroundColor: theme.colors.background }, style]}>
        {body}
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={styles.scrollContent}
    >
      {body}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: spacing.xxl },
  body: { gap: spacing.md, flex: 1 },
  header: { gap: spacing.xs, marginBottom: spacing.sm },
});
