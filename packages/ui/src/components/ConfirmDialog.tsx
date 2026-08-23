import { Modal, StyleSheet, View } from 'react-native';
import { useTheme, spacing, radius } from '@platform/theme';
import { AppText } from './AppText';
import { Button } from './Button';
import { TextField } from './TextField';

export interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  /** When set, the user must type this exact phrase before confirming. */
  confirmationPhrase?: string;
  typedPhrase?: string;
  onTypedPhraseChange?: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Destructive operations require explicit confirmation — see CLAUDE.md rule 8. */
export function ConfirmDialog({
  visible,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  confirmationPhrase,
  typedPhrase = '',
  onTypedPhraseChange,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const theme = useTheme();
  const phraseSatisfied = !confirmationPhrase || typedPhrase.trim() === confirmationPhrase;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={[styles.scrim, { backgroundColor: theme.colors.overlay }]}>
        <View style={[styles.sheet, { backgroundColor: theme.colors.surface }]}>
          <View style={[styles.handle, { backgroundColor: theme.colors.border }]} />
          <AppText variant="title">{title}</AppText>
          <AppText variant="body" tone="muted">
            {description}
          </AppText>
          {confirmationPhrase ? (
            <TextField
              label={`Type "${confirmationPhrase}" to confirm`}
              value={typedPhrase}
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={onTypedPhraseChange}
            />
          ) : null}
          <View style={styles.actions}>
            <Button label={cancelLabel} variant="secondary" onPress={onCancel} />
            <Button
              label={confirmLabel}
              variant={destructive ? 'danger' : 'primary'}
              disabled={!phraseSatisfied}
              loading={busy}
              onPress={onConfirm}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    padding: spacing.lg,
    gap: spacing.md,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  handle: { alignSelf: 'center', width: 44, height: 4, borderRadius: radius.pill },
  actions: { gap: spacing.sm },
});
