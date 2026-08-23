import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Button, Screen, TextField, AppText } from '@platform/ui';
import { spacing } from '@platform/theme';
import { errorCode } from '@platform/utils';
import { useAuth } from '../AuthProvider';
import { validateEmail } from '../credentials';

export interface PasswordResetScreenProps {
  messageForCode: (code: string) => string;
  sentMessage: string;
  onBack: () => void;
}

export function PasswordResetScreen({ messageForCode, sentMessage, onBack }: PasswordResetScreenProps) {
  const { service } = useAuth();
  const [email, setEmail] = useState('');
  const [issue, setIssue] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    const validated = validateEmail(email);
    if (!validated.ok) {
      setIssue(validated.error);
      return;
    }
    setIssue(null);
    setBusy(true);
    try {
      await service.sendPasswordReset(validated.value);
      setSent(true);
    } catch (error) {
      setIssue(errorCode(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Reset password">
      <View style={styles.form}>
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        {issue ? (
          <AppText variant="meta" tone="down">
            {messageForCode(issue)}
          </AppText>
        ) : null}
        {sent ? (
          <AppText variant="meta" tone="up">
            {sentMessage}
          </AppText>
        ) : null}
        <Button label="Send reset link" loading={busy} onPress={() => void submit()} />
        <Button label="Back" variant="ghost" onPress={onBack} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
});
