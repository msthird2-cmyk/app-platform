import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Button, Screen, TextField, AppText } from '@platform/ui';
import { spacing } from '@platform/theme';
import { errorCode } from '@platform/utils';
import { useAuth } from '../AuthProvider';

export interface DeviceVerificationProps {
  deviceId: string;
  description: string;
  messageForCode: (code: string) => string;
  onVerified: () => void;
}

export function DeviceVerification({
  deviceId,
  description,
  messageForCode,
  onVerified,
}: DeviceVerificationProps) {
  const { service } = useAuth();
  const [code, setCode] = useState('');
  const [issue, setIssue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>, after?: () => void): Promise<void> => {
    setIssue(null);
    setBusy(true);
    try {
      await action();
      after?.();
    } catch (error) {
      setIssue(errorCode(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Verify this device" subtitle={description}>
      <View style={styles.form}>
        <TextField
          label="Verification code"
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          autoComplete="one-time-code"
        />
        {issue ? (
          <AppText variant="meta" tone="down">
            {messageForCode(issue)}
          </AppText>
        ) : null}
        <Button
          label="Verify"
          loading={busy}
          onPress={() => void run(() => service.confirmDeviceVerification(deviceId, code.trim()), onVerified)}
        />
        <Button
          label="Send a new code"
          variant="ghost"
          onPress={() => void run(() => service.sendDeviceVerification(deviceId))}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
});
