import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { AppText, Button, Card, ConfirmDialog } from '@platform/ui';
import { spacing, radius, useTheme } from '@platform/theme';
import { errorCode } from '@platform/utils';

export interface DeleteAccountProps {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Ask the user to type this phrase before the confirm button enables. */
  requireConfirmation?: boolean;
  confirmationPhrase?: string;
  messageForCode: (code: string) => string;
  onDelete: () => Promise<void>;
}

/**
 * One configurable component for every application — never a per-app fork.
 * The tinted container is deliberate: the danger zone is the one grouped block.
 */
export function DeleteAccount({
  title,
  description,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  requireConfirmation = true,
  confirmationPhrase = 'DELETE',
  messageForCode,
  onDelete,
}: DeleteAccountProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<string | null>(null);

  const confirm = async (): Promise<void> => {
    setBusy(true);
    setIssue(null);
    try {
      await onDelete();
      setOpen(false);
      setTyped('');
    } catch (error) {
      setIssue(errorCode(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={[styles.zone, { backgroundColor: theme.colors.surfaceMuted }]}>
      <AppText variant="title" tone="down">
        {title}
      </AppText>
      <AppText variant="body" tone="muted">
        {description}
      </AppText>
      {issue ? (
        <AppText variant="meta" tone="down">
          {messageForCode(issue)}
        </AppText>
      ) : null}
      <View style={styles.action}>
        <Button label={confirmLabel} variant="danger" onPress={() => setOpen(true)} />
      </View>
      <ConfirmDialog
        visible={open}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        destructive
        busy={busy}
        {...(requireConfirmation ? { confirmationPhrase } : {})}
        typedPhrase={typed}
        onTypedPhraseChange={setTyped}
        onConfirm={() => void confirm()}
        onCancel={() => {
          setOpen(false);
          setTyped('');
        }}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  zone: { borderRadius: radius.md, gap: spacing.sm },
  action: { marginTop: spacing.xs },
});
