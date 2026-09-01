import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useAuth } from '@platform/auth';
import { AppText, Button, ConfirmDialog, TextField } from '@platform/ui';
import { spacing } from '@platform/theme';
import { errorCode } from '@platform/utils';
import { runBackup, runRestore, type BackupProgress } from '@platform/backup';
import { useAppConfig, useBackupTransport, useCryptoService, useRepository } from './ServicesProvider';

/**
 * Export and import, without a screen or a route.
 *
 * The same arrangement as `PairNewDeviceButton`: it renders nothing at all
 * unless a transport was injected, so an application with no way to hand
 * somebody a file offers no backup rather than one that silently goes nowhere.
 * That is why this is here rather than in `packages/backup` — it needs
 * `useRepository()`, and the dependency runs core → backup, never back.
 *
 * It is deliberately not `BackupScreen`. That component wraps itself in a
 * `Screen`, which belongs to an application with navigation to route to it;
 * this is the smallest thing that exposes the capability where there is none.
 *
 * The repository comes from `useRepository()`, so a backup reads domain objects
 * through the encryption boundary and a restore writes back through it. Neither
 * flow can reach the store underneath, which is the point of both assertions
 * inside them.
 */
export interface BackupControlsProps {
  /** Records that may be exported and restored. The application's own. */
  collections: readonly string[];
  messageForCode?: (code: string) => string;
}

export function BackupControls({ collections, messageForCode }: BackupControlsProps) {
  const transport = useBackupTransport();
  const repository = useRepository();
  const crypto = useCryptoService();
  const config = useAppConfig();
  const { user } = useAuth();

  const [passphrase, setPassphrase] = useState('');
  const [issue, setIssue] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<BackupProgress['phase'] | null>(null);

  // Nothing to offer without somewhere to put the file, or without an owner to
  // bind the ciphertext to.
  if (!transport || !user) return null;

  const run = async (action: () => Promise<string>): Promise<void> => {
    setBusy(true);
    setIssue(null);
    setNote(null);
    try {
      setNote(await action());
    } catch (error) {
      const code = errorCode(error);
      // Dismissing the picker is not a failure and is not reported as one.
      if (code !== 'BACKUP_CANCELLED') setIssue(code);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const onExport = () =>
    void run(async () => {
      const summary = await runBackup(repository, crypto, transport, {
        appName: config.appName,
        userId: user.id,
        collections,
        passphrase,
        now: Date.now(),
        onProgress: (update) => setProgress(update.phase),
      });
      setPassphrase('');
      return `Saved ${summary.recordCount} records to ${summary.fileName}. Keep that file somewhere you control.`;
    });

  const onImport = () =>
    void run(async () => {
      const result = await runRestore(repository, crypto, transport, {
        userId: user.id,
        appName: config.appName,
        collections,
        passphrase,
        confirmed: true,
        onProgress: (update) => setProgress(update.phase),
      });
      setPassphrase('');
      return `Restored ${result.restored} records.`;
    });

  return (
    <View style={styles.section}>
      <AppText variant="title">Backup</AppText>

      <TextField
        label="Backup passphrase"
        value={passphrase}
        onChangeText={setPassphrase}
        secureTextEntry
        hint="This encrypts the file. It is never sent anywhere and cannot be reset — without it nobody can open the backup, including us."
      />

      {issue ? (
        <AppText variant="meta" tone="down">
          {messageForCode ? messageForCode(issue) : issue}
        </AppText>
      ) : null}
      {note ? <AppText variant="meta">{note}</AppText> : null}
      {progress ? <AppText variant="meta">{progress}…</AppText> : null}

      <Button label="Export backup" loading={busy} onPress={onExport} />
      <AppText variant="meta">
        Export creates an encrypted file and hands it to you to save or share.
        This app keeps no copy, so a backup you do not save is one you do not
        have. It is not the same as your recovery code, which restores your key
        rather than your records.
      </AppText>

      <Button
        label="Import backup"
        variant="secondary"
        loading={busy}
        onPress={() => setConfirming(true)}
      />

      <ConfirmDialog
        visible={confirming}
        title="Restore from a backup file?"
        description="You will choose a backup file. Restoring replaces the records on this device with the ones inside it, and needs the passphrase that file was encrypted with."
        confirmLabel="Choose file"
        destructive
        busy={busy}
        onConfirm={() => {
          setConfirming(false);
          onImport();
        }}
        onCancel={() => setConfirming(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.xs, marginTop: spacing.lg },
});
