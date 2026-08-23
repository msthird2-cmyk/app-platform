import { StyleSheet, View, type ViewProps } from 'react-native';
import { useTheme, spacing, radius } from '@platform/theme';

export interface CardProps extends ViewProps {
  padded?: boolean;
}

export function Card({ padded = true, style, ...props }: CardProps) {
  const theme = useTheme();
  return (
    <View
      {...props}
      style={[
        styles.card,
        { backgroundColor: theme.colors.surface, padding: padded ? spacing.md : 0 },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.md, gap: spacing.sm },
});
