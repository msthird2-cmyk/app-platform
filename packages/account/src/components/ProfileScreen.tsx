import { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { AppText, Button, Loading, Screen, TextField } from '@platform/ui';
import { spacing } from '@platform/theme';
import { errorCode, formatDate } from '@platform/utils';
import type { AccountService, UserProfile } from '../types/account';

export interface ProfileScreenProps {
  service: AccountService;
  messageForCode: (code: string) => string;
  savedMessage: string;
}

export function ProfileScreen({ service, messageForCode, savedMessage }: ProfileScreenProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [issue, setIssue] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void service
      .getProfile()
      .then((loaded) => {
        if (!active) return;
        setProfile(loaded);
        setDisplayName(loaded.displayName ?? '');
      })
      .catch((error: unknown) => {
        if (active) setIssue(errorCode(error));
      });
    return () => {
      active = false;
    };
  }, [service]);

  const save = async (): Promise<void> => {
    setBusy(true);
    setIssue(null);
    setSaved(false);
    try {
      setProfile(await service.updateProfile({ displayName: displayName.trim() }));
      setSaved(true);
    } catch (error) {
      setIssue(errorCode(error));
    } finally {
      setBusy(false);
    }
  };

  if (!profile) return <Loading label="Loading profile" />;

  return (
    <Screen title="Profile">
      <View style={styles.form}>
        <TextField label="Name" value={displayName} onChangeText={setDisplayName} autoComplete="name" />
        <AppText variant="meta" tone="muted">
          {profile.email}
        </AppText>
        <AppText variant="meta" tone="muted">
          {`Member since ${formatDate(new Date(profile.createdAt))}`}
        </AppText>
        {issue ? (
          <AppText variant="meta" tone="down">
            {messageForCode(issue)}
          </AppText>
        ) : null}
        {saved ? (
          <AppText variant="meta" tone="up">
            {savedMessage}
          </AppText>
        ) : null}
        <Button label="Save" loading={busy} onPress={() => void save()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
});
