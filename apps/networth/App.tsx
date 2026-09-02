import {
  AppCore,
  BackupControls,
  PairNewDeviceButton,
  PassphraseControls,
} from '@platform/core';
import { LoginScreen } from '@platform/auth';
import { getRandomBytes } from 'expo-crypto';
import {
  createCryptoService,
  createDataKeyLifecycle,
  createKeyCustody,
  createRecordCipher,
} from '@platform/security';
import type { SecureStorage } from '@platform/security';
import { NetWorthScreen } from './src/screens/NetWorthScreen';
import { messageForCode } from './src/messages';
import { COLLECTIONS } from './src/collections';
import type { NetWorthServices } from './src/composition/services';
import { DEMO_ASSETS, DEMO_LIABILITIES, DEMO_PREVIOUS_NET_WORTH } from './src/demo';

export const APP_NAME = 'Net Worth';

export { COLLECTIONS };

export interface NetWorthAppProps {
  /**
   * Every backend-dependent service, chosen by the entry point.
   *
   * One object rather than six props: the six must come from the same
   * composition, and passing them separately is what would let a build end up
   * with Firebase records and an in-memory escrow — a user whose data is on the
   * server and whose recovery path evaporates when the process exits.
   */
  services: NetWorthServices;
  secureStorage: SecureStorage;
  /**
   * The tier this application will accept for key custody. Decided by the
   * entry point, which knows which storage it built, rather than inferred from
   * whatever turned up — inferring it would accept a downgrade silently.
   */
  minimumProtection?: 'os-keystore' | 'browser-nonextractable';
}

/**
 * Composition root for Net Worth.
 *
 * The cryptography is identical in both backends and is built here: the same
 * record cipher, the same custody, the same lifecycle. Only what sits *below*
 * the encryption boundary differs, which is the property that makes a preview
 * build meaningful evidence about the production one.
 */
export default function App({
  services,
  secureStorage,
  minimumProtection = 'os-keystore',
}: NetWorthAppProps) {
  const cryptoService = createCryptoService({ randomBytes: getRandomBytes });
  // AES-256-GCM directly under the data encryption key. No KDF: the key is
  // already 256 random bits, and stretching it at the shipped 210,000 rounds
  // would add roughly 25 seconds to saving a single record on Android.
  const recordCipher = createRecordCipher({ randomBytes: getRandomBytes });

  /**
   * One lifecycle per signed-in user. The escrow is bound to the user id, so
   * it cannot be built until there is one — `AppCore` calls this inside its
   * auth gate. Custody is Gate 2's; nothing here stores a key itself.
   */
  const dataKeyLifecycleFor = (userId: string) =>
    createDataKeyLifecycle({
      // The owner is what makes this record this user's. Without it two
      // people on one device share a key; see `custodyAddress.ts`.
      custody: createKeyCustody(secureStorage, { owner: userId, minimumProtection }),
      escrowStore: services.escrowStore,
      crypto: cryptoService,
      context: { userId, appName: APP_NAME },
      randomBytes: getRandomBytes,
    });

  return (
    <AppCore
      appName={APP_NAME}
      collections={COLLECTIONS}
      authService={services.authService}
      accountService={services.accountService}
      backupTransport={services.backupTransport}
      repository={services.repository}
      cryptoService={cryptoService}
      dataKeyLifecycleFor={dataKeyLifecycleFor}
      recordCipher={recordCipher}
      pairingRelay={services.pairingRelay}
      randomBytes={getRandomBytes}
      secureStorage={secureStorage}
      signedOut={
        <LoginScreen
          messageForCode={messageForCode}
          onForgotPassword={() => undefined}
          onCreateAccount={() => undefined}
        />
      }
    >
      <>
        {/* Renders nothing unless a pairing relay was injected. The trusted
            device is the one that can give a copy of the key to another. */}
        <PairNewDeviceButton />
        <NetWorthScreen
          // Production starts empty; a preview seeds the sample portfolio
          // through the same encrypted write path so it is not a special case.
          seed={
            services.backend === 'preview'
              ? { assets: DEMO_ASSETS, liabilities: DEMO_LIABILITIES }
              : undefined
          }
          previousNetWorth={
            services.backend === 'preview' ? DEMO_PREVIOUS_NET_WORTH : null
          }
        />
        {/* Renders nothing unless a backup transport was injected. */}
        <BackupControls collections={COLLECTIONS} messageForCode={messageForCode} />
        {/* The passphrase in front of this device's key. Renders nothing
            outside the gate, where there is no key to protect. */}
        <PassphraseControls messageForCode={messageForCode} />
      </>
    </AppCore>
  );
}
