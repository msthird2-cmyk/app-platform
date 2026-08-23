import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Button, Screen, TextField, AppText } from '@platform/ui';
import { spacing } from '@platform/theme';
import { errorCode } from '@platform/utils';
import { useAuth } from '../AuthProvider';
import { validateCredentials } from '../credentials';

export interface LoginScreenProps {
  title?: string;
  subtitle?: string;
  /** The application maps error and issue codes to its own copy. */
  messageForCode: (code: string) => string;
  onForgotPassword: () => void;
  onCreateAccount: () => void;
}

export function LoginScreen({
  title = 'Sign in',
  subtitle,
  messageForCode,
  onForgotPassword,
  onCreateAccount,
}: LoginScreenProps) {
  const { signIn } = useAuth();
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
      await signIn(validated.value);
    } catch (error) {
      setIssue(errorCode(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={title} subtitle={subtitle}>
      <View style={styles.form}>
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
          autoComplete="current-password"
        />
        {issue ? (
          <AppText variant="meta" tone="down">
            {messageForCode(issue)}
          </AppText>
        ) : null}
        <Button label="Sign in" loading={busy} onPress={() => void submit()} />
        <Button label="Forgot password" variant="ghost" onPress={onForgotPassword} />
        <Button label="Create account" variant="secondary" onPress={onCreateAccount} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
});
