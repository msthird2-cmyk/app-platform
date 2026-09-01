import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { AppText, Button, ConfirmDialog, Screen, TextField } from '@platform/ui';
import { spacing } from '@platform/theme';
import { errorCode } from '@platform/utils';
import { BackupStatus } from './BackupStatus';
import type { BackupProgress, BackupSettings } from '../types/backup';

/**
 * Two actions, and no list.
 *
 * There is nothing to list: the application does not keep backups. An export
 * produces one encrypted file and hands it to the person, who decides where it
 * lives, and an import asks them for a file back. A list here would be a list
 * of things the server holds, which is exactly what this design removed — and
 * showing one would tell the person something untrue about where their data is.
 *
 * The copy says so plainly, in both directions: the file is theirs to keep, and
 * nobody can open it or recover it for them without the passphrase.
 */
export interface BackupScreenProps {
  settings: BackupSettings;
  now: number;
  progress?: BackupProgress;
  messageForCode: (code: string) => string;
  labelForState: (state: 'fresh' | 'due' | 'overdue' | 'never') => string;
  onExport: (passphrase: string) => Promise<void>;
  onImport: (passphrase: string) => Promise<void>;
}

export function BackupScreen({
  settings,
  now,
  progress,
  messageForCode,
  labelForState,
  onExport,
  onImport,
}: BackupScreenProps) {
  const [passphrase, setPassphrase] = useState('');
  const [issue, setIssue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingImport, setConfirmingImport] = useState(false);

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
        hint="This passphrase encrypts the file. It is never sent anywhere, and it cannot be reset — without it the backup cannot be opened, by you or by anyone else."
      />

      {issue ? (
        <AppText variant="meta" tone="down">
          {messageForCode(issue)}
        </AppText>
      ) : null}

      <Button
        label="Export backup"
        loading={busy}
        onPress={() => void run(() => onExport(passphrase))}
      />
      <AppText variant="meta">
        Your backup is an encrypted file. Save it somewhere you control — your
        cloud drive, your computer, or send it to yourself. This app does not
        keep a copy, so a backup you do not save is a backup you do not have.
      </AppText>

      <View style={styles.import}>
        <AppText variant="title">Restore from a file</AppText>
        <Button
          label="Import backup"
          variant="secondary"
          loading={busy}
          onPress={() => setConfirmingImport(true)}
        />
      </View>

      <ConfirmDialog
        visible={confirmingImport}
        title="Restore from this backup?"
        description="Restoring replaces the records on this device with the ones in the file you choose."
        confirmLabel="Choose file"
        destructive
        busy={busy}
        onConfirm={() => {
          void run(() => onImport(passphrase)).then(() => setConfirmingImport(false));
        }}
        onCancel={() => setConfirmingImport(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  import: { gap: spacing.xs, marginTop: spacing.lg },
});
