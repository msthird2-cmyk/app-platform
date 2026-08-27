import { useCallback, useEffect, useState } from 'react';
import { AppText, Button, Loading, Screen, TextField } from '@platform/ui';
import type { PairingSession, PairingSessionView } from '@platform/security';
import { pairingFailureMessage, pairingStep } from './pairingStep';

/**
 * The screen a person looks at while two devices pair.
 *
 * It contains no cryptography and makes no protocol decision. It subscribes to
 * a `PairingSession` — which owns the key agreement, the transport key and the
 * wrapped payload, none of which are on the view it publishes — renders what
 * `pairingStep` says to render, and turns two button presses into
 * `confirm()` and `cancel()`.
 *
 * The confirm button is the security control this whole screen exists for. It
 * says nothing to the relay: pressing it authorises *this* device to publish
 * the wrapped key, or to open one, and that is the only effect it has.
 */
export interface PairingFlowProps {
  session: PairingSession;
  /** Called once the key has moved. The gate re-reads its status. */
  onComplete: () => void;
  onCancel: () => void;
  labels?: Partial<PairingFlowLabels>;
}

export interface PairingFlowLabels {
  initiatorTitle: string;
  initiatorBody: string;
  responderTitle: string;
  responderBody: string;
  sessionIdLabel: string;
  joinLabel: string;
  joinPlaceholder: string;
  joinAction: string;
  startAction: string;
  waiting: string;
  compareTitle: string;
  compareBody: string;
  confirmAction: string;
  transferring: string;
  doneTitle: string;
  doneBody: string;
  doneAction: string;
  cancelAction: string;
  retryAction: string;
}

const DEFAULT_LABELS: PairingFlowLabels = {
  initiatorTitle: 'Pair a new device',
  initiatorBody:
    'Your encryption key stays on your devices. This sends a copy to one more '
    + 'of them, locked so that only that device can open it.',
  responderTitle: 'Use another signed-in device',
  responderBody:
    'Open your other device, start pairing there, and enter the pairing code '
    + 'it shows you.',
  sessionIdLabel: 'Pairing code',
  joinLabel: 'Pairing code',
  joinPlaceholder: 'Code from your other device',
  joinAction: 'Join',
  startAction: 'Start pairing',
  waiting: 'Waiting for your other device',
  compareTitle: 'Check these numbers match',
  compareBody:
    'Both devices should be showing the same six digits. If they differ, stop — '
    + 'something is between your devices.',
  confirmAction: 'They match',
  transferring: 'Transferring your key',
  doneTitle: 'Both devices are paired',
  doneBody: 'This device can now read your records.',
  doneAction: 'Continue',
  cancelAction: 'Cancel',
  retryAction: 'Start again',
};

export function PairingFlow({ session, onComplete, onCancel, labels }: PairingFlowProps) {
  const text = { ...DEFAULT_LABELS, ...labels };
  const [view, setView] = useState<PairingSessionView>(() => session.view());
  const [entered, setEntered] = useState('');

  useEffect(() => session.subscribe(setView), [session]);

  // Cancelling on unmount rather than leaving a session live: a screen the user
  // navigated away from must not still be able to publish a wrapped key.
  useEffect(() => () => session.cancel(), [session]);

  const start = useCallback(() => void session.start(), [session]);
  const join = useCallback(() => void session.join(entered.trim()), [session, entered]);
  const confirm = useCallback(() => void session.confirm(), [session]);

  const step = pairingStep(view.phase, view.code);

  if (step === 'idle') {
    return (
      <Screen>
        <AppText variant="title">
          {view.role === 'initiator' ? text.initiatorTitle : text.responderTitle}
        </AppText>
        <AppText>{view.role === 'initiator' ? text.initiatorBody : text.responderBody}</AppText>
        {view.role === 'responder' ? (
          <TextField
            label={text.joinLabel}
            value={entered}
            onChangeText={setEntered}
            placeholder={text.joinPlaceholder}
            autoCapitalize="none"
          />
        ) : null}
        <Button
          label={view.role === 'initiator' ? text.startAction : text.joinAction}
          onPress={view.role === 'initiator' ? start : join}
          disabled={view.busy || (view.role === 'responder' && entered.trim().length === 0)}
        />
        <Button label={text.cancelAction} variant="ghost" onPress={onCancel} />
      </Screen>
    );
  }

  if (step === 'waiting') {
    return (
      <Screen>
        <AppText variant="title">
          {view.role === 'initiator' ? text.initiatorTitle : text.responderTitle}
        </AppText>
        {view.role === 'initiator' && view.sessionId ? (
          <>
            <AppText tone="muted" variant="label">
              {text.sessionIdLabel.toUpperCase()}
            </AppText>
            {/* Public, and not a secret: it identifies the session, and the
                commitment is what makes substituting a key detectable. */}
            <AppText variant="title" accessibilityLabel={view.sessionId.split('').join(' ')}>
              {view.sessionId}
            </AppText>
          </>
        ) : null}
        <Loading label={text.waiting} />
        <Button label={text.cancelAction} variant="ghost" onPress={onCancel} />
      </Screen>
    );
  }

  if (step === 'compare-code') {
    return (
      <Screen>
        <AppText variant="title">{text.compareTitle}</AppText>
        <AppText>{text.compareBody}</AppText>
        <AppText variant="title" accessibilityLabel={(view.code ?? '').split('').join(' ')}>
          {view.code}
        </AppText>
        <Button label={text.confirmAction} onPress={confirm} disabled={view.busy} />
        <Button label={text.cancelAction} variant="ghost" onPress={onCancel} />
      </Screen>
    );
  }

  if (step === 'transferring') return <Loading label={text.transferring} />;

  if (step === 'done') {
    return (
      <Screen>
        <AppText variant="title">{text.doneTitle}</AppText>
        <AppText>{text.doneBody}</AppText>
        <Button label={text.doneAction} onPress={onComplete} />
      </Screen>
    );
  }

  return (
    <Screen>
      <AppText variant="title">
        {view.role === 'initiator' ? text.initiatorTitle : text.responderTitle}
      </AppText>
      <AppText tone="down">{pairingFailureMessage(view.reason)}</AppText>
      {/* No path from here to recovery or to setup. Starting again means a new
          pairing with new ephemeral keys; choosing recovery instead is the
          user's decision, made on the screen that offers it. */}
      <Button label={text.retryAction} onPress={onCancel} />
    </Screen>
  );
}
