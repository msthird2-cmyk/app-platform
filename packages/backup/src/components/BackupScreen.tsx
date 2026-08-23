import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { AppText, Button, ConfirmDialog, ListRow, Screen, TextField } from '@platform/ui';
import { spacing } from '@platform/theme';
import { errorCode, formatDate } from '@platform/utils';
import { BackupStatus } from './BackupStatus';
import type { BackupProgress, BackupSettings, BackupSummary } from '../types/backup';

export interface BackupScreenProps {
  settings: BackupSettings;
  backups: readonly BackupSummary[];
  now: number;
  progress?: BackupProgress;
  messageForCode: (code: string) => string;
  labelForState: (state: 'fresh' | 'due' | 'overdue' | 'never') => string;
  onBackup: (passphrase: string) => Promise<void>;
  onRestore: (backupId: string, passphrase: string) => Promise<void>;
}

export function BackupScreen({
  settings,
  backups,
  now,
  progress,
  messageForCode,
  labelForState,
  onBackup,
  onRestore,
}: BackupScreenProps) {
  const [passphrase, setPassphrase] = useState('');
  const [issue, setIssue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setIssue(null);
    try {
      await action();
    } catch (error) {
      setIssue(errorCode(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Backup">
      <BackupStatus
        settings={settings}
        now={now}
        labelForState={labelForState}
        {...(progress ? { progress } : {})}
      />
      <TextField
        label="Backup passphrase"
        value={passphrase}
        onChangeText={setPassphrase}
        secureTextEntry
        hint="Your backup is encrypted with this passphrase. It is never uploaded."
      />
      {issue ? (
        <AppText variant="meta" tone="down">
          {messageForCode(issue)}
        </AppText>
      ) : null}
      <Button label="Back up now" loading={busy} onPress={() => void run(() => onBackup(passphrase))} />

      <View style={styles.list}>
        <AppText variant="title">Available backups</AppText>
        {backups.map((backup) => (
          <ListRow
            key={backup.id}
            title={formatDate(new Date(backup.createdAt))}
            meta={`${backup.recordCount} records`}
            value="Restore"
            onPress={() => setRestoreTarget(backup.id)}
          />
        ))}
      </View>

      <ConfirmDialog
        visible={restoreTarget !== null}
        title="Restore this backup?"
        description="Restoring replaces the records on this device with the ones in the backup."
        confirmLabel="Restore"
        destructive
        busy={busy}
        onConfirm={() => {
          const target = restoreTarget;
          if (!target) return;
          void run(() => onRestore(target, passphrase)).then(() => setRestoreTarget(null));
        }}
        onCancel={() => setRestoreTarget(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.xs, marginTop: spacing.lg },
});
