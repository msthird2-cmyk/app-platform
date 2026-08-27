import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppText, Button, Loading, Screen, TextField } from '@platform/ui';
import type { DataKeyLifecycle, DataKeyState, PairingRole, PairingSession } from '@platform/security';
import { dataKeyStep } from './dataKeyStep';
import { PairDeviceProvider } from './PairDeviceContext';
import { PairingFlow } from './PairingFlow';

/**
 * Where the data encryption key enters the application's life.
 *
 * This sits inside the auth gate, so it runs once a user is signed in and
 * before any screen that could touch their records. It asks the lifecycle what
 * state the key is in and does exactly what that state allows — it never
 * decides on its own that a key is missing, and it has no path that creates one
 * except the explicit first-time setup below.
 *
 * `unusable` renders a dead end on purpose. Something is stored and cannot be
 * read, and every other option at that point — silently re-running setup,
 * silently offering recovery — ends with a new key written over a real one and
 * every record encrypted under the original orphaned. There is no button here
 * that resolves it, because there is no safe automatic resolution.
 */
export interface DataKeyGateProps {
  lifecycle: DataKeyLifecycle;
  children: ReactNode;
  /** Lets an application substitute its own copy. */
  labels?: Partial<DataKeyGateLabels>;
  /**
   * Builds a pairing session for a role, or is absent.
   *
   * Absent means no relay was wired, and then no pairing is offered anywhere —
   * neither beside the recovery code nor on the trusted-device path. A button
   * that started something the application cannot finish would be worse than no
   * button.
   */
  pairingSessionFor?: ((role: PairingRole) => PairingSession) | undefined;
}

export interface DataKeyGateLabels {
  preparing: string;
  setupTitle: string;
  setupBody: string;
  setupAction: string;
  codeTitle: string;
  codeBody: string;
  codeConfirm: string;
  recoverTitle: string;
  recoverBody: string;
  recoverAction: string;
  recoverPlaceholder: string;
  recoverFailed: string;
  unusableTitle: string;
  unusableBody: string;
  pairInsteadAction: string;
}

const DEFAULT_LABELS: DataKeyGateLabels = {
  preparing: 'Preparing your encryption key',
  setupTitle: 'Set up encryption',
  setupBody:
    'Your records are encrypted with a key only this device holds. Setting up '
    + 'gives you a recovery code, which is the only way back if you lose every '
    + 'device you have signed in on.',
  setupAction: 'Create my key',
  codeTitle: 'Save your recovery code',
  codeBody:
    'Write this down and keep it somewhere safe. It is shown once and is not '
    + 'stored anywhere. Without it, and without a signed-in device, your '
    + 'records cannot be recovered by anyone — including us.',
  codeConfirm: 'I have saved it',
  recoverTitle: 'Enter your recovery code',
  recoverBody:
    'This account has an encryption key that this device does not hold. Enter '
    + 'the recovery code you saved to restore it.',
  recoverAction: 'Recover',
  recoverPlaceholder: 'XXXX-XXXX-XXXX',
  recoverFailed: 'That code did not open your key. Check it and try again.',
  unusableTitle: 'Your encryption key cannot be read',
  unusableBody:
    'A key is stored on this device but cannot be opened — this usually follows '
    + 'a change to the device lock screen. Sign in on another device, or use '
    + 'your recovery code there. Setting up again here would permanently orphan '
    + 'your existing records, so this app will not do it automatically.',
  pairInsteadAction: 'Use another signed-in device',
};

export function DataKeyGate({
  lifecycle,
  children,
  labels,
  pairingSessionFor,
}: DataKeyGateProps) {
  const text = { ...DEFAULT_LABELS, ...labels };
  const [state, setState] = useState<DataKeyState | null>(null);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [entered, setEntered] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pairingRole, setPairingRole] = useState<PairingRole | null>(null);

  const refresh = useCallback(async () => {
    setState(await lifecycle.status());
  }, [lifecycle]);

  useEffect(() => {
    let cancelled = false;
    lifecycle.status().then(
      (next) => !cancelled && setState(next),
      // A status check that throws is not evidence that there is no key.
      () => !cancelled && setState('unusable'),
    );
    return () => {
      cancelled = true;
    };
  }, [lifecycle]);

  const runSetup = useCallback(async () => {
    setBusy(true);
    try {
      const { recoveryCode: code } = await lifecycle.initialize();
      // Held in component state only, for as long as it is on screen.
      setRecoveryCode(code);
    } catch {
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [lifecycle, refresh]);

  const runRecovery = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    try {
      await lifecycle.recover(entered);
      setEntered('');
      await refresh();
    } catch {
      // Deliberately one message for every failure. A wrong code and a
      // tampered escrow are indistinguishable here, and neither produced a key.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [lifecycle, entered, refresh]);

  // Built once per attempt. A new session means new ephemeral keys, which is
  // what starting again has to mean.
  const pairingSession = useMemo(
    () => (pairingSessionFor && pairingRole ? pairingSessionFor(pairingRole) : null),
    [pairingSessionFor, pairingRole],
  );

  const endPairing = useCallback(() => {
    setPairingRole(null);
    void refresh();
  }, [refresh]);

  const step = dataKeyStep(state, recoveryCode, pairingRole === 'responder');

  if (step === 'show-code' && recoveryCode !== null) {
    return (
      <Screen>
        <AppText variant="title">{text.codeTitle}</AppText>
        <AppText>{text.codeBody}</AppText>
        <AppText variant="title" accessibilityLabel={recoveryCode.split('').join(' ')}>
          {recoveryCode}
        </AppText>
        <Button
          label={text.codeConfirm}
          onPress={() => {
            setRecoveryCode(null);
            void refresh();
          }}
        />
      </Screen>
    );
  }

  if (step === 'loading') return <Loading label={text.preparing} />;

  if (step === 'setup') {
    return (
      <Screen>
        <AppText variant="title">{text.setupTitle}</AppText>
        <AppText>{text.setupBody}</AppText>
        <Button label={text.setupAction} onPress={() => void runSetup()} disabled={busy} />
      </Screen>
    );
  }

  if (step === 'recover') {
    return (
      <Screen>
        <AppText variant="title">{text.recoverTitle}</AppText>
        <AppText>{text.recoverBody}</AppText>
        <TextField
          label={text.recoverTitle}
          value={entered}
          onChangeText={setEntered}
          placeholder={text.recoverPlaceholder}
          autoCapitalize="characters"
        />
        {failed ? <AppText tone="down">{text.recoverFailed}</AppText> : null}
        <Button label={text.recoverAction} onPress={() => void runRecovery()} disabled={busy} />
        {/* An explicit second path, never an automatic fallback in either
            direction: a failed recovery does not start pairing, and a failed
            pairing does not consume the recovery code. */}
        {pairingSessionFor ? (
          <Button
            label={text.pairInsteadAction}
            variant="secondary"
            onPress={() => setPairingRole('responder')}
          />
        ) : null}
      </Screen>
    );
  }

  if (step === 'pair' && pairingSession) {
    return (
      <PairingFlow session={pairingSession} onComplete={endPairing} onCancel={endPairing} />
    );
  }

  if (step === 'blocked') {
    return (
      <Screen>
        <AppText variant="title">{text.unusableTitle}</AppText>
        <AppText>{text.unusableBody}</AppText>
      </Screen>
    );
  }

  // The trusted-device path. This device holds the key, so it is the one that
  // can give a copy to another; the initiator flow replaces the application
  // while it runs, and hands back to it either way.
  if (pairingSession && pairingRole === 'initiator') {
    return (
      <PairingFlow session={pairingSession} onComplete={endPairing} onCancel={endPairing} />
    );
  }

  return (
    <PairDeviceProvider
      value={{
        available: pairingSessionFor !== undefined,
        begin: () => setPairingRole('initiator'),
      }}
    >
      {children}
    </PairDeviceProvider>
  );
}
