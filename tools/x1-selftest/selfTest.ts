import { getRandomBytes } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

/**
 * X-1 runtime self-test.
 *
 * The host test suite proves the portable crypto path is correct under Node and
 * V8. What it cannot prove is that it is correct under **Hermes**, which is a
 * different engine with its own typed-array and 32-bit arithmetic
 * implementation — and a divergence there would not crash, it would produce
 * different bytes, surfacing much later as a backup that will not open. This
 * runs the same operations on the real engine, on a real Android image.
 *
 * It is deliberately not part of any shipped application: nothing here is
 * imported by `apps/`, and the whole directory exists to be built by CI and
 * thrown away.
 *
 * Every result is printed with a `X1|` prefix between two sentinels, because
 * the only channel out of an Android app in CI is logcat.
 */

const TAG = 'X1|';

export interface SelfTestOutcome {
  passed: boolean;
  lines: string[];
}

/** The five globals the portable path must never need. */
const BROWSER_GLOBALS = ['crypto', 'btoa', 'atob', 'TextEncoder', 'TextDecoder'] as const;

interface HermesRuntime {
  getRuntimeProperties?: () => Record<string, string>;
}

function hermesDescription(): { isHermes: boolean; description: string } {
  const hermes = (globalThis as { HermesInternal?: HermesRuntime }).HermesInternal;
  if (hermes == null) {
    return { isHermes: false, description: 'HermesInternal absent — this is NOT Hermes' };
  }
  let version = 'unknown';
  try {
    const properties = hermes.getRuntimeProperties?.() ?? {};
    version =
      properties['OSS Release Version'] ??
      properties['Build'] ??
      Object.keys(properties).join(',') ??
      'unknown';
  } catch {
    version = 'properties unavailable';
  }
  return { isHermes: true, description: `Hermes ${version}` };
}

export async function runSelfTest(): Promise<SelfTestOutcome> {
  const lines: string[] = [];
  let failures = 0;

  const record = (name: string, ok: boolean, detail = '') => {
    if (!ok) failures += 1;
    lines.push(`${TAG} ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`);
  };
  const note = (text: string) => lines.push(`${TAG} ${text}`);

  // ---- the engine ------------------------------------------------------
  //
  // Asserted rather than assumed. A build that silently fell back to JSC would
  // otherwise report a green run that proves nothing about the target.
  const engine = hermesDescription();
  note(`ENGINE ${engine.description}`);
  record('runs on Hermes', engine.isHermes, engine.isHermes ? '' : 'engine is not Hermes');
  if (!engine.isHermes) {
    return { passed: false, lines };
  }

  // ---- entropy ---------------------------------------------------------
  //
  // Captured from the native module before any global is touched, exactly as a
  // composition root captures it at startup.
  let randomBytes: (length: number) => Uint8Array;
  try {
    randomBytes = (length: number) => getRandomBytes(length);
    const sample = randomBytes(16);
    const allZero = sample.every((byte) => byte === 0);
    record(
      'expo-crypto returns entropy across the bridge',
      sample instanceof Uint8Array && sample.length === 16 && !allZero,
      `len=${sample.length} allZero=${allZero}`,
    );
  } catch (error) {
    record('expo-crypto returns entropy across the bridge', false, String(error));
    return { passed: false, lines };
  }

  // ---- remove the globals ---------------------------------------------
  //
  // Which of these Hermes/React Native happens to provide is itself worth
  // recording; the point is that the crypto path works with none of them.
  const container = globalThis as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  const present: string[] = [];
  for (const name of BROWSER_GLOBALS) {
    if (container[name] !== undefined) present.push(name);
    saved[name] = container[name];
    delete container[name];
  }
  note(`GLOBALS_PRESENT_BEFORE_DELETION ${present.length > 0 ? present.join(',') : '(none)'}`);

  try {
    for (const name of BROWSER_GLOBALS) {
      record(`global ${name} is absent during the run`, container[name] === undefined);
    }

    // Imported only now, so module evaluation itself happens with the globals
    // gone. A top-level read of one of them would throw here.
    const security = await import('@platform/security');
    const {
      PortableCryptoService,
      WebCryptoService,
      createCryptoService,
      generateRecoveryCode,
      generateRecoveryCodes,
      normalizeRecoveryCode,
      hashRecoveryCodes,
      verifyRecoveryCode,
      DEFAULT_KDF_ITERATIONS,
      MIN_KDF_ITERATIONS,
    } = security;
    record('@platform/security module graph evaluates', typeof createCryptoService === 'function');

    const CONTEXT = { userId: 'user-1', appName: 'Net Worth' };
    const OTHER_USER = { userId: 'user-2', appName: 'Net Worth' };
    const OTHER_APP = { userId: 'user-1', appName: 'Expense' };

    // ---- selection ------------------------------------------------------
    const selected = createCryptoService({ randomBytes, iterations: MIN_KDF_ITERATIONS });
    record(
      'createCryptoService selects PortableCryptoService without WebCrypto',
      selected instanceof PortableCryptoService && !(selected instanceof WebCryptoService),
      selected.constructor.name,
    );

    // The fast service carries the suite; the production cost is measured
    // separately below rather than paid by every case.
    const crypto = new PortableCryptoService({ randomBytes, iterations: MIN_KDF_ITERATIONS });

    // ---- AES-256-GCM round trip -----------------------------------------
    const PLAINTEXT = 'net worth: 1234 — café 日本 \u{1f510}';
    const payload = await crypto.encrypt(PLAINTEXT, 'correct horse battery', CONTEXT);
    const back = await crypto.decrypt(payload, 'correct horse battery', CONTEXT);
    record('AES-256-GCM round trip', back === PLAINTEXT, `${back.length} chars`);
    record(
      'envelope is version 1 AES-GCM',
      payload.version === 1 && payload.algorithm === 'AES-GCM',
      `v=${payload.version} alg=${payload.algorithm}`,
    );
    record('ciphertext does not contain the plaintext', !JSON.stringify(payload).includes('1234'));

    const rejects = async (name: string, run: () => Promise<unknown>) => {
      try {
        await run();
        record(name, false, 'accepted when it should have been rejected');
      } catch {
        record(name, true);
      }
    };

    // ---- rejection ------------------------------------------------------
    const flip = (value: string) => {
      const chars = [...value];
      chars[2] = chars[2] === 'A' ? 'B' : 'A';
      return chars.join('');
    };
    await rejects('tampered ciphertext rejected', () =>
      crypto.decrypt({ ...payload, ciphertext: flip(payload.ciphertext) }, 'correct horse battery', CONTEXT),
    );
    await rejects('wrong key rejected', () =>
      crypto.decrypt(payload, 'wrong passphrase', CONTEXT),
    );
    await rejects('wrong AAD rejected (different user)', () =>
      crypto.decrypt(payload, 'correct horse battery', OTHER_USER),
    );
    await rejects('wrong AAD rejected (different application)', () =>
      crypto.decrypt(payload, 'correct horse battery', OTHER_APP),
    );

    // ---- PBKDF2 hashing and verification --------------------------------
    const stored = await crypto.hashSecret('ABCD-EFGH-JKLM');
    const right = await crypto.verifySecret('ABCD-EFGH-JKLM', stored);
    const wrong = await crypto.verifySecret('WRON-GCOD-EXXX', stored);
    record('PBKDF2 hashSecret / verifySecret', right && !wrong, `right=${right} wrong=${wrong}`);
    record('stored hash is PBKDF2-SHA256 and salted', stored.algorithm === 'PBKDF2-SHA256' && stored.salt.length > 0);

    // ---- recovery codes --------------------------------------------------
    const code = generateRecoveryCode(randomBytes);
    const shapeOk = /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code);
    record('recovery-code generation with injected entropy', shapeOk, code.replace(/[A-Z2-9]/g, '#'));
    const codes = generateRecoveryCodes(randomBytes, 8);
    record(
      'recovery codes are distinct and use the safe alphabet',
      new Set(codes).size === 8 && !codes.join('').match(/[IO01]/),
    );
    record('recovery code normalizes to itself', normalizeRecoveryCode(code) === code);

    const records = await hashRecoveryCodes([code], crypto, { now: Date.now() });
    const verified = await verifyRecoveryCode(code, records, crypto, Date.now());
    record('recovery code hashes and verifies', verified.valid);

    // ---- PBKDF2 at the production cost -----------------------------------
    //
    // The iteration count is the shipped default, deliberately not lowered:
    // the number this prints is the one a user will actually wait for.
    const production = new PortableCryptoService({
      randomBytes,
      iterations: DEFAULT_KDF_ITERATIONS,
    });
    const started = Date.now();
    const productionHash = await production.hashSecret('timing-probe');
    const elapsed = Date.now() - started;
    record(
      `PBKDF2 at the production cost (${DEFAULT_KDF_ITERATIONS} rounds)`,
      productionHash.iterations === DEFAULT_KDF_ITERATIONS,
    );
    note(`PBKDF2_ITERATIONS ${DEFAULT_KDF_ITERATIONS}`);
    note(`PBKDF2_MS ${elapsed}`);

    const encryptStarted = Date.now();
    const productionPayload = await production.encrypt('timing', 'passphrase', CONTEXT);
    const encryptElapsed = Date.now() - encryptStarted;
    note(`ENCRYPT_MS ${encryptElapsed}`);
    record(
      'production-cost payload round-trips',
      (await production.decrypt(productionPayload, 'passphrase', CONTEXT)) === 'timing',
    );

    // ---- Gate 2: secure key custody -------------------------------------
    //
    // Same reasoning as the crypto above. `expo-secure-store` reaches a native
    // module across the bridge; whether that module is present, and whether a
    // key survives a round trip through the Android Keystore, cannot be
    // learned from a host test. The key here is fixed, obviously fake, and
    // never a real one.
    const { createPlatformSecureStorage, createKeyCustody } = security;
    const TEST_DEK = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 13) % 256);

    const secureStoreAvailable = await SecureStore.isAvailableAsync();
    record('expo-secure-store is available', secureStoreAvailable);

    // Record the platform fact this gate exists to establish. The accessibility
    // constants are read off the native module and only the iOS module defines
    // them, so on Android this must be undefined. A build where it became a
    // number would mean the library changed under us, and the conditional rule
    // in OsKeystoreStorage would then start demanding a choice here.
    record(
      'keychain accessibility is an iOS-only concept on this device',
      SecureStore.AFTER_FIRST_UNLOCK === undefined,
      `AFTER_FIRST_UNLOCK=${String(SecureStore.AFTER_FIRST_UNLOCK)}`,
    );

    if (secureStoreAvailable) {
      const storage = await createPlatformSecureStorage({
        secureStore: SecureStore,
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
        keychainService: 'x1-selftest',
      });
      record(
        'platform storage reports the os-keystore tier',
        storage.protection === 'os-keystore',
        storage.protection,
      );

      const custody = createKeyCustody(storage, { storageKey: 'x1.selftest.dek' });

      // Start from a known-clean slate: a previous run may have left a key.
      await custody.clear();
      record('custody reports absent before anything is stored',
        (await custody.status()) === 'absent');
      record('load returns null when absent', (await custody.load()) === null);

      await custody.store(TEST_DEK);
      record('custody reports present after storing', (await custody.status()) === 'present');

      const loaded = await custody.load();
      const identical =
        loaded !== null &&
        loaded.length === TEST_DEK.length &&
        loaded.every((byte, i) => byte === TEST_DEK[i]);
      record('loaded bytes are identical to what was stored', identical,
        `${loaded === null ? 'null' : loaded.length} bytes`);

      await custody.clear();
      record('custody reports absent after clear', (await custody.status()) === 'absent');
      record('load returns null after clear', (await custody.load()) === null);

      // Fail-closed paths, on the device rather than against a mock.
      let refusedMemory = false;
      try {
        createKeyCustody(new security.InMemorySecureStorage());
      } catch {
        refusedMemory = true;
      }
      record('custody refuses process-memory storage', refusedMemory);

      let refusedUnavailable = false;
      try {
        await createPlatformSecureStorage({
          secureStore: { ...SecureStore, isAvailableAsync: async () => false },
          keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
        });
      } catch {
        refusedUnavailable = true;
      }
      record('storage fails closed when SecureStore reports unavailable', refusedUnavailable);

      let rejectedBadKey = false;
      try {
        await custody.store(new Uint8Array(16));
      } catch {
        rejectedBadKey = true;
      }
      record('custody refuses a key of the wrong length', rejectedBadKey);
      // Leave nothing behind on the device.
      await custody.clear();
    }
  } catch (error) {
    record('self-test completed without an unexpected throw', false, String(error));
  } finally {
    for (const name of BROWSER_GLOBALS) {
      if (saved[name] !== undefined) container[name] = saved[name];
    }
  }

  return { passed: failures === 0, lines };
}
