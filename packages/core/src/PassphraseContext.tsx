import { createContext, useContext, useState, type ReactNode } from 'react';
import { AppText, Button, TextField } from '@platform/ui';
import { errorCode } from '@platform/utils';

/**
 * Turning the data-key passphrase on, off is not offered, and changing it.
 *
 * A context for the same reason pairing is one: the affordance belongs wherever
 * an application keeps its security settings, and `DataKeyGate` is the only
 * thing holding the lifecycle that can do it. Children render only once the key
 * is available, so every operation below already has a key to work with.
 *
 * There is deliberately no "remove passphrase". Taking protection off is the
 * one operation whose failure mode is silent — the user believes their key is
 * behind a passphrase when it is not — and nothing in the product needs it.
 */
export interface DataKeyPassphrase {
  /** Whether this device's key is currently behind a passphrase. */
  protected: boolean;
  /** Puts a passphrase in front of the key already on this device. */
  protect: (passphrase: string) => Promise<void>;
  /** Re-wraps the same key. Requires the current passphrase. */
  change: (currentPassphrase: string, nextPassphrase: string) => Promise<void>;
}

const PassphraseContext = createContext<DataKeyPassphrase | null>(null);

export function PassphraseProvider({
  value,
  children,
}: {
  value: DataKeyPassphrase;
  children: ReactNode;
}) {
  return <PassphraseContext.Provider value={value}>{children}</PassphraseContext.Provider>;
}

/** `null` outside the gate, where there is no key to protect. */
export function useDataKeyPassphrase(): DataKeyPassphrase | null {
  return useContext(PassphraseContext);
}

export interface PassphraseControlsProps {
  messageForCode?: (code: string) => string;
}

/**
 * The smallest thing that makes the wrapper reachable.
 *
 * Renders nothing outside the gate. No route and no screen of its own — an
 * application drops it wherever its settings live, exactly as it does with
 * `PairNewDeviceButton`.
 */
export function PassphraseControls({ messageForCode }: PassphraseControlsProps) {
  const passphrase = useDataKeyPassphrase();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [issue, setIssue] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!passphrase) return null;

  const run = async (action: () => Promise<void>, done: string): Promise<void> => {
    setBusy(true);
    setIssue(null);
    setNote(null);
    try {
      await action();
      // Cleared on success and on failure alike: neither field outlives the
      // attempt that used it.
      setCurrent('');
      setNext('');
      setNote(done);
    } catch (error) {
      setCurrent('');
      setNext('');
      setIssue(errorCode(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <AppText variant="title">Passphrase</AppText>

      {passphrase.protected ? (
        <>
          <TextField
            label="Current passphrase"
            value={current}
            onChangeText={setCurrent}
            secureTextEntry
          />
          <TextField
            label="New passphrase"
            value={next}
            onChangeText={setNext}
            secureTextEntry
          />
          <Button
            label="Change passphrase"
            loading={busy}
            onPress={() => void run(() => passphrase.change(current, next), 'Passphrase changed.')}
          />
          <AppText variant="meta">
            Your key is protected. Changing the passphrase re-wraps the same key,
            so nothing needs re-encrypting and no record is touched.
          </AppText>
        </>
      ) : (
        <>
          <TextField
            label="New passphrase"
            value={next}
            onChangeText={setNext}
            secureTextEntry
          />
          <Button
            label="Protect with a passphrase"
            loading={busy}
            onPress={() => void run(() => passphrase.protect(next), 'Your key is now protected.')}
          />
          <AppText variant="meta">
            Without this, anyone who can use this device can read your records.
            With it, they need the passphrase too — asked for once each time the
            app starts. It is never sent anywhere and cannot be reset. Forgetting
            it costs you this device, not your data: your recovery code still
            works on a fresh install.
          </AppText>
        </>
      )}

      {issue ? (
        <AppText variant="meta" tone="down">
          {messageForCode ? messageForCode(issue) : issue}
        </AppText>
      ) : null}
      {note ? <AppText variant="meta">{note}</AppText> : null}
    </>
  );
}
