import { View, StyleSheet } from 'react-native';
import { AppText, Card, ProgressBar } from '@platform/ui';
import { spacing } from '@platform/theme';
import { formatDate } from '@platform/utils';
import { describeStaleness } from '../services/schedule';
import type { BackupProgress, BackupSettings } from '../types/backup';

export interface BackupStatusProps {
  settings: BackupSettings;
  now: number;
  progress?: BackupProgress;
  labelForState: (state: 'fresh' | 'due' | 'overdue' | 'never') => string;
}

export function BackupStatus({ settings, now, progress, labelForState }: BackupStatusProps) {
  const state = describeStaleness(settings, now);
  const tone = state === 'fresh' ? 'up' : state === 'overdue' ? 'down' : 'warn';

  return (
    <Card>
      <View style={styles.row}>
        <AppText variant="body" style={styles.label}>
          Backup
        </AppText>
        <AppText variant="body" tone={tone}>
          {labelForState(state)}
        </AppText>
      </View>
      {settings.lastBackupAt !== null ? (
        <AppText variant="meta" tone="muted">
          {`Last backup ${formatDate(new Date(settings.lastBackupAt))}`}
        </AppText>
      ) : null}
      {progress && progress.phase !== 'idle' && progress.phase !== 'done' ? (
        <ProgressBar progress={progress.completion} label="Backup progress" />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  label: { fontWeight: '600' },
});
