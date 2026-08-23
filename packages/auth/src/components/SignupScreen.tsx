import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Button, Screen, TextField, AppText } from '@platform/ui';
import { spacing } from '@platform/theme';
import { errorCode } from '@platform/utils';
import { useAuth } from '../AuthProvider';
import { validateCredentials } from '../credentials';

export interface SignupScreenProps {
  title?: string;
  messageForCode: (code: string) => string;
  onBackToSignIn: () => void;
}

export function SignupScreen({ title = 'Create account', messageForCode, onBackToSignIn }: SignupScreenProps) {
  const { signUp } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [issue, setIssue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    const validated = validateCredentials(email, password);
    if (!validated.ok) {
      setIssue(validated.error);
      return;
    }
    setIssue(null);
    setBusy(true);
    try {
      await signUp(validated.value, displayName.trim() || undefined);
    } catch (error) {
      setIssue(errorCode(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={title}>
      <View style={styles.form}>
        <TextField label="Name" value={displayName} onChangeText={setDisplayName} autoComplete="name" />
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
        />
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          hint="At least 10 characters, with a letter and a number."
        />
        {issue ? (
          <AppText variant="meta" tone="down">
            {messageForCode(issue)}
          </AppText>
        ) : null}
        <Button label="Create account" loading={busy} onPress={() => void submit()} />
        <Button label="Back to sign in" variant="ghost" onPress={onBackToSignIn} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
});
