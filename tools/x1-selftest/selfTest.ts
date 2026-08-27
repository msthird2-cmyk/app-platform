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
    const {
      createPlatformSecureStorage,
      createKeyCustody,
      P256KeyAgreement,
      createRecordCipher,
      createPairingOffer,
      acceptPairing,
      derivePairingAgreement,
      wrapDataKeyForPairing,
      completePairing,
      commitToPublicKey,
      createDataKeyLifecycle,
      createPairingSession,
      InMemoryPairingRelay,
      InMemoryRecoveryEscrowStore,
      createRecoveryEscrow,
      openRecoveryEscrow,
      recoverDataKey,
      toRecoveryEscrowDocument,
      fromRecoveryEscrowDocument,
    } = security;
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

      // ---- Gate 3: zero-trusted-device recovery escrow -------------------
      //
      // Correctness of the escrow construction on this engine is what is being
      // established here, and that does not depend on the KDF cost — the
      // production cost is already exercised above, on this same device, by the
      // 210,000-round check. So these run at the policy minimum, exactly as the
      // host suite does, because each escrow operation is a full derivation and
      // at production cost this block alone would take over a minute per case.
      const escrowContext = { userId: 'x1-selftest-uid', appName: 'x1-selftest' };
      const RECOVERY_CODE = 'K7QM-2XPD-9RTF';

      const escrow = await createRecoveryEscrow(TEST_DEK, RECOVERY_CODE, crypto, escrowContext);
      record('recovery escrow wraps the key on Hermes', escrow.version === 1);

      // Base64 of TEST_DEK, encoded inline. Not `btoa` — this block runs with
      // the browser globals deleted, which is the point of the harness — and
      // not the package codec, which is internal. A literal would drift from
      // the constant, so it is computed from it.
      const toBase64Bytes = (bytes: Uint8Array): string => {
        const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        let out = '';
        for (let i = 0; i < bytes.length; i += 3) {
          const a = bytes[i] as number;
          const b = bytes[i + 1];
          const c = bytes[i + 2];
          out += ALPHA[a >> 2];
          out += ALPHA[((a & 3) << 4) | ((b ?? 0) >> 4)];
          out += b === undefined ? '=' : ALPHA[((b & 15) << 2) | ((c ?? 0) >> 6)];
          out += c === undefined ? '=' : ALPHA[c & 63];
        }
        return out;
      };

      const dekBase64 = (() => {
        const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        let out = '';
        for (let i = 0; i < TEST_DEK.length; i += 3) {
          const a = TEST_DEK[i] as number;
          const b = TEST_DEK[i + 1];
          const c = TEST_DEK[i + 2];
          out += ALPHA[a >> 2];
          out += ALPHA[((a & 3) << 4) | ((b ?? 0) >> 4)];
          out += b === undefined ? '=' : ALPHA[((b & 15) << 2) | ((c ?? 0) >> 6)];
          out += c === undefined ? '=' : ALPHA[c & 63];
        }
        return out;
      })();
      const serialised = JSON.stringify(escrow);
      record(
        'escrow carries neither the key nor the code',
        !serialised.includes(dekBase64) &&
          !serialised.includes(RECOVERY_CODE) &&
          !serialised.includes('K7QM2XPD9RTF'),
      );

      const unwrapped = await openRecoveryEscrow(escrow, RECOVERY_CODE, crypto, escrowContext);
      const escrowIdentical =
        unwrapped.length === TEST_DEK.length &&
        unwrapped.every((byte, i) => byte === TEST_DEK[i]);
      record('escrow unwraps to byte-identical key material', escrowIdentical,
        `${unwrapped.length} bytes`);

      // What is deliberately NOT re-derived here. Each escrow operation is a
      // full PBKDF2 pass — about twelve seconds on this hardware — and the
      // first version of this block ran eight of them, adding roughly a
      // hundred seconds and pushing API 34 past the sentinel timeout while API
      // 29 squeaked under it. So the device gate keeps only what the *engine*
      // could plausibly get wrong, and the host suite keeps the rest:
      //
      //   recovery-code normalisation  — string handling, identical on any engine
      //   tampered-ciphertext refusal  — the same AEAD rejection the X-1 block
      //                                  above already proves on this device
      //   wrong code via openRecoveryEscrow — the recoverDataKey case below
      //                                  exercises the same derivation and also
      //                                  proves custody is left alone
      //
      // Nothing about the construction is weakened; the cost of the derivation
      // is unchanged, and every one of these cases is covered exhaustively in
      // packages/security/tests/recoveryEscrow.test.ts.

      // The stored document is a pure shape mapping, so it is checked as one
      // rather than by paying for another decryption.
      const document = toRecoveryEscrowDocument('current', escrow);
      const rebuilt = fromRecoveryEscrowDocument(document);
      record(
        'escrow survives the stored document round trip',
        rebuilt.version === escrow.version &&
          rebuilt.wrappedKey.ciphertext === escrow.wrappedKey.ciphertext &&
          rebuilt.wrappedKey.iv === escrow.wrappedKey.iv &&
          rebuilt.wrappedKey.salt === escrow.wrappedKey.salt &&
          rebuilt.wrappedKey.iterations === escrow.wrappedKey.iterations,
      );
      record('stored document exposes no key or code material',
        !JSON.stringify(document).includes(RECOVERY_CODE) &&
          !JSON.stringify(document).includes(dekBase64));

      // The whole zero-trusted-device path, on the device: no key in custody,
      // one recovery code, key restored through Gate 2 custody and nowhere else.
      await custody.clear();
      record('custody is empty before recovery', (await custody.status()) === 'absent');

      let recoveryRefusedWrongCode = false;
      try {
        await recoverDataKey({
          escrow, recoveryCode: 'AAAA-BBBB-CCCC', crypto, context: escrowContext, custody,
        });
      } catch {
        recoveryRefusedWrongCode = true;
      }
      record('a wrong recovery code cannot produce a key', recoveryRefusedWrongCode);
      record('and leaves custody empty', (await custody.status()) === 'absent');

      let recoveryRefusedMissing = false;
      try {
        await recoverDataKey({
          escrow: null, recoveryCode: RECOVERY_CODE, crypto, context: escrowContext, custody,
        });
      } catch {
        recoveryRefusedMissing = true;
      }
      record('recovery without an escrow fails rather than minting a key',
        recoveryRefusedMissing);
      record('and still leaves custody empty', (await custody.status()) === 'absent');

      await recoverDataKey({
        escrow, recoveryCode: RECOVERY_CODE, crypto, context: escrowContext, custody,
      });
      const restored = await custody.load();
      record('recovery restores the key through Gate 2 custody',
        restored !== null && restored.every((byte, i) => byte === TEST_DEK[i]),
        `${restored === null ? 'null' : restored.length} bytes`);

      // ---- Gate 4: trusted-device pairing --------------------------------
      //
      // What this proves that the host suite cannot: that P-256 ECDH and
      // HKDF-SHA256 execute under Hermes at all, and that two independent
      // agreements on this engine reach byte-identical transport keys. A
      // divergence there would not crash — it would mean two real devices
      // could never pair, discovered long after shipping.
      //
      // No PBKDF2 anywhere in this block: the pairing transport derives from a
      // Diffie-Hellman secret, and the whole block costs milliseconds rather
      // than the ~25 seconds one production-cost derivation takes here.
      await custody.clear();

      const agreement = new P256KeyAgreement(randomBytes);
      const pairingCipher = createRecordCipher({ randomBytes });
      const PAIR_UID = 'x1-pairing-uid';

      const { keyPair: initiator, session: offered } = createPairingOffer({
        appName: 'x1-selftest',
        now: Date.now(),
        randomBytes,
        agreement,
      });
      record('ECDH generates an ephemeral key pair on Hermes',
        initiator.publicKey.length === 33 && initiator.privateKey.length === 32,
        `pub=${initiator.publicKey.length} priv=${initiator.privateKey.length}`);
      record('the offer publishes a commitment and no key',
        offered.initiatorPublicKey === null && offered.commitment.length > 0);

      const { keyPair: responder, responderPublicKey } = acceptPairing({
        session: offered, now: Date.now(), agreement,
      });
      const published = {
        ...offered,
        responderPublicKey,
        initiatorPublicKey: toBase64Bytes(initiator.publicKey),
      };

      const sideA = derivePairingAgreement({
        session: published, privateKey: initiator.privateKey,
        userId: PAIR_UID, now: Date.now(), agreement,
      });
      const sideB = derivePairingAgreement({
        session: published, privateKey: responder.privateKey,
        userId: PAIR_UID, now: Date.now(), agreement,
      });

      record('both sides derive the same transport key',
        sideA.transportKey.length === 32 &&
          sideA.transportKey.every((byte, i) => byte === sideB.transportKey[i]));
      record('both sides show the same verification code',
        sideA.code === sideB.code && /^\d{3}-\d{3}$/.test(sideA.code));

      const pairContext = {
        userId: PAIR_UID, appName: 'x1-selftest', sessionId: offered.id,
      };
      const wrappedKey = await wrapDataKeyForPairing({
        dataKey: TEST_DEK, transportKey: sideA.transportKey,
        context: pairContext, cipher: pairingCipher,
      });
      record('the wrapped key carries no key material',
        !JSON.stringify(wrappedKey).includes(dekBase64));

      const paired = await completePairing({
        session: { ...published, wrapped: wrappedKey },
        transportKey: sideB.transportKey,
        context: pairContext, cipher: pairingCipher, custody, now: Date.now(),
      });
      record('the other side opens the wrapped key and takes custody',
        paired.every((byte, i) => byte === TEST_DEK[i]),
        `${paired.length} bytes`);

      await custody.clear();

      // Substitution: a relay swaps its own key in after seeing the
      // responder's. The commitment was published first, so it no longer opens.
      let substitutionCaught = false;
      try {
        const mitm = agreement.generate();
        derivePairingAgreement({
          session: { ...published, initiatorPublicKey: toBase64Bytes(mitm.publicKey) },
          privateKey: mitm.privateKey, userId: PAIR_UID, now: Date.now(), agreement,
        });
      } catch {
        substitutionCaught = true;
      }
      record('a substituted public key fails the commitment', substitutionCaught);
      record('the commitment is reproducible on this engine',
        commitToPublicKey(initiator.publicKey) === offered.commitment);

      // ---- Gate 4 integration: the whole flow, driven ---------------------
      //
      // The block above proves the primitives run on Hermes. This proves the
      // orchestration does: two lifecycles over two real Android Keystore
      // entries, a relay between them, and the key moving from one to the other
      // through the same code path the application uses.
      //
      // Still no PBKDF2. Neither `exportForPairing` nor `adoptPairedKey`
      // touches the recovery escrow, and neither lifecycle is initialised — the
      // trusted device's key is placed in custody directly, exactly as the
      // block above does.
      const trustedStorageKey = 'x1.selftest.pair.trusted';
      const freshStorageKey = 'x1.selftest.pair.fresh';
      const trustedCustody = createKeyCustody(storage, { storageKey: trustedStorageKey });
      const freshCustody = createKeyCustody(storage, { storageKey: freshStorageKey });
      await trustedCustody.clear();
      await freshCustody.clear();
      await trustedCustody.store(TEST_DEK);

      const escrowStore = new InMemoryRecoveryEscrowStore();
      const lifecycleFor = (custodyForDevice: ReturnType<typeof createKeyCustody>) =>
        createDataKeyLifecycle({
          custody: custodyForDevice,
          escrowStore,
          crypto,
          context: { userId: PAIR_UID, appName: 'x1-selftest' },
          randomBytes,
        });

      const pairClock = { value: Date.now() };
      const relay = new InMemoryPairingRelay(() => pairClock.value);
      const sessionFor = (
        role: 'initiator' | 'responder',
        custodyForDevice: ReturnType<typeof createKeyCustody>,
      ) =>
        createPairingSession({
          role,
          relay,
          lifecycle: lifecycleFor(custodyForDevice),
          cipher: pairingCipher,
          randomBytes,
          userId: PAIR_UID,
          appName: 'x1-selftest',
          now: () => pairClock.value,
          agreement,
        });

      const settle = async () => {
        for (let i = 0; i < 12; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
      };

      const trustedSide = sessionFor('initiator', trustedCustody);
      const freshSide = sessionFor('responder', freshCustody);

      await trustedSide.start();
      await settle();
      await freshSide.join(trustedSide.view().sessionId as string);
      await settle();
      record('the driver reaches the comparison step on both devices',
        trustedSide.view().phase === 'compare-code' &&
          freshSide.view().phase === 'compare-code',
        `${trustedSide.view().phase}/${freshSide.view().phase}`);
      record('both devices show the same code through the driver',
        trustedSide.view().code !== null && trustedSide.view().code === freshSide.view().code,
        String(trustedSide.view().code));

      await freshSide.confirm();
      await settle();
      await trustedSide.confirm();
      await settle();
      await settle();

      const adopted = await freshCustody.load();
      record('the key reaches the second device through Gate 2 custody',
        adopted !== null && adopted.length === 32 && adopted.every((b, i) => b === TEST_DEK[i]),
        `${adopted === null ? 'null' : adopted.length} bytes`);
      record('the trusted device still holds the same key',
        (await trustedCustody.status()) === 'present');

      // An expired pairing, which is the failure a person is most likely to
      // hit. What must not happen is a replacement key appearing instead.
      await freshCustody.clear();
      const staleTrusted = sessionFor('initiator', trustedCustody);
      const staleFresh = sessionFor('responder', freshCustody);
      await staleTrusted.start();
      await settle();
      await staleFresh.join(staleTrusted.view().sessionId as string);
      await settle();
      pairClock.value += 10 * 60 * 1000;
      await staleFresh.confirm();
      await settle();
      record('an expired pairing fails rather than completing',
        staleFresh.view().phase === 'failed',
        String(staleFresh.view().reason));
      record('and mints no replacement key on the device that failed',
        (await freshCustody.status()) === 'absent');

      // Leave nothing behind on the device.
      await trustedCustody.clear();
      await freshCustody.clear();
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
