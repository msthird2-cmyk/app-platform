import { type ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import { AppText, Screen } from '@platform/ui';
import { spacing, ThemeSelector } from '@platform/theme';

export interface SettingsSection {
  title: string;
  content: ReactNode;
}

export interface SettingsScreenProps {
  title?: string;
  sections?: readonly SettingsSection[];
  dangerZone?: ReactNode;
}

export function SettingsScreen({ title = 'Settings', sections = [], dangerZone }: SettingsScreenProps) {
  return (
    <Screen title={title}>
      <ThemeSelector />
      {sections.map((section) => (
        <View key={section.title} style={styles.section}>
          <AppText variant="title">{section.title}</AppText>
          {section.content}
        </View>
      ))}
      {dangerZone ? <View style={styles.section}>{dangerZone}</View> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm, marginTop: spacing.lg },
});
