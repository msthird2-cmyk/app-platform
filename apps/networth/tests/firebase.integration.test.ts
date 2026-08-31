import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import {
  P256KeyAgreement,
  acceptPairing,
  completePairing,
  createCryptoService,
  createPairingOffer,
  createRecordCipher,
  createRecoveryEscrow,
  derivePairingAgreement,
  fromRecoveryEscrowDocument,
  openRecoveryEscrow,
  toRecoveryEscrowDocument,
  wrapDataKeyForPairing,
  type KeyCustody,
} from '@platform/security';
import { EncryptingRepository, type Repository } from '@platform/data';
// The exact function `useRepository()` returns, reached by its module path
// rather than the package barrel. Importing `@platform/core` would pull in
// AppCore and therefore React Native, whose entry point is Flow-typed source
// that Vite cannot parse under Node. Nothing about the control changes: this is
// the same `repositoryForConsumer`, asserting the same encryption boundary.
import { repositoryForConsumer } from '../../../packages/core/dist/repositoryAccess.js';
import { createProductionServices } from '../src/composition/services';
import { listAssets, saveAsset } from '../src/data/netWorthRepository';
import { COLLECTIONS } from '../src/collections';

/** Matches `APP_NAME` in App.tsx, which cannot be imported here for the same
 *  reason: it lives in a module that renders. The value is load-bearing — it is
 *  bound into the AAD of every record — so the assertion below pins it. */
const APP_NAME = 'Net Worth';

/**
 * Gate 6. The same composition a production build runs, against a real
 * Firebase project.
 *
 * Everything above this file is unchanged: `createProductionServices` is the
 * one Net Worth ships, `EncryptingRepository` is built exactly as
 * `EncryptedRepositoryProvider` builds it, and the repository handed to the
 * data module goes through `repositoryForConsumer` — the function
 * `useRepository()` returns. No crypto, no rule and no envelope is adjusted to
 * make any of this pass.
 *
 * **Skipped unless a project is configured.** An unconfigured checkout runs
 * every other suite and skips this one, so CI stays green without credentials
 * and nobody is tempted to commit any.
 *
 * **What this cannot cover, by design.** Gate 2 custody refuses any store
 * reporting the `memory` protection tier, and a Node process cannot honestly
 * claim `os-keystore` or `browser-nonextractable`. Rather than fake a tier,
 * the data key is held in the harness and handed to `EncryptingRepository`
 * through the same `DataKeySource` callback the lifecycle satisfies. Custody
 * itself is covered on real hardware by the Hermes self-test on API 29 and 34.
 */

const REQUIRED = [
  'EXPO_PUBLIC_FIREBASE_API_KEY',
  'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'EXPO_PUBLIC_FIREBASE_APP_ID',
  'NETWORTH_TEST_EMAIL',
  'NETWORTH_TEST_PASSWORD',
] as const;

const configured = REQUIRED.every((name) => (process.env[name] ?? '').trim().length > 0);

const NETWORK_MS = 60_000;

/** Node's CSPRNG, in the slot a device build fills with `expo-crypto`. */
function randomBytes(length: number): Uint8Array {
  return webcrypto.getRandomValues(new Uint8Array(length));
}

/**
 * The raw document as Firestore holds it, read over REST rather than through
 * the SDK path under test. An independent observation: if the client library
 * were somehow decrypting on the way out, this would still show ciphertext.
 */
async function rawDocument(
  token: string,
  path: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const project = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/${path}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** A write attempted straight at Firestore, bypassing every client control. */
async function rawWrite(
  token: string | null,
  path: string,
  fields: Record<string, unknown>,
): Promise<{ status: number; reason: string }> {
  const project = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/${path}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ fields }),
    },
  );
  const body = (await response.json().catch(() => ({}))) as {
    error?: { status?: string };
  };
  return { status: response.status, reason: body.error?.status ?? '' };
}

describe.skipIf(!configured)('Gate 6: Net Worth against real Firebase', () => {
  let services: ReturnType<typeof createProductionServices>;
  let repository: ReturnType<typeof repositoryForConsumer>;
  let inner: Repository;
  let dataKey: Uint8Array;
  let userId: string;
  let idToken: string;
  const written: string[] = [];

  const cryptoService = createCryptoService({ randomBytes });
  const recordCipher = createRecordCipher({ randomBytes });

  beforeAll(async () => {
    services = createProductionServices({
      apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY as string,
      authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN as string,
      projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID as string,
      storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET as string,
      messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID as string,
      appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID as string,
    });

    const user = await services.authService.signIn({
      email: process.env.NETWORTH_TEST_EMAIL as string,
      password: process.env.NETWORTH_TEST_PASSWORD as string,
    });
    userId = user.id;

    // The token the Security Rules will evaluate. Fetched the same way any
    // client would; used here only to read documents back independently.
    const response = await fetch(
      'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' +
        process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: process.env.NETWORTH_TEST_EMAIL,
          password: process.env.NETWORTH_TEST_PASSWORD,
          returnSecureToken: true,
        }),
      },
    );
    idToken = ((await response.json()) as { idToken: string }).idToken;

    dataKey = randomBytes(32);
    inner = services.repository;
    repository = repositoryForConsumer(
      new EncryptingRepository({
        inner,
        cipher: recordCipher,
        dataKey: async () => dataKey,
        userId,
        appName: APP_NAME,
      }),
    );
  }, NETWORK_MS);

  afterAll(async () => {
    // Step 9. The project is disposable but the account is not: leave nothing.
    // Records go through the repository's own hard delete, which the rules
    // permit an owner precisely so account deletion can clear the subtree.
    for (const id of written) {
      await purge(`users/${userId}/${COLLECTIONS[0]}/${id}`);
    }
    for (const probe of ['plaintext-probe', 'reserved-probe']) {
      await purge(`users/${userId}/${COLLECTIONS[0]}/${probe}`);
    }
    // The escrow store exposes only load and save; removal is the owner's
    // `allow delete` on the same path.
    await purge(`users/${userId}/recoveryEscrow/current`);
    for (const session of pairingSessions) {
      await purge(`users/${userId}/pairing/${session}`);
    }
    await purge(`users/${userId}/pairing/expired-probe`);
  }, NETWORK_MS);

  /** Session ids created by the pairing suite, removed on the way out. */
  const pairingSessions: string[] = [];

  /** Removes one document, if it is there. Cleanup must never fail a run. */
  async function purge(path: string): Promise<void> {
    const project = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
    await fetch(
      `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/${path}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${idToken}` } },
    ).catch(() => undefined);
  }

  it('signs in with a verified address', async () => {
    expect(userId).toMatch(/^[A-Za-z0-9]{10,}$/);
    expect(idToken.length).toBeGreaterThan(100);

    // The rules gate every record write on this claim, so a run against an
    // unverified account would fail later and confusingly. Assert it here.
    const claims = JSON.parse(
      Buffer.from(idToken.split('.')[1], 'base64url').toString(),
    ) as { email_verified?: boolean };
    expect(claims.email_verified).toBe(true);
  });

  it('pins the application name bound into every record`s AAD', async () => {
    // App.tsx cannot be imported here, so the constant is duplicated above.
    // This reads the source and fails if the two ever drift apart.
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../App.tsx', import.meta.url), 'utf8');
    expect(source).toContain(`export const APP_NAME = '${APP_NAME}'`);
  });

  describe('record round trip', () => {
    const asset = {
      name: 'Sovereign gold bonds',
      category: 'gold' as const,
      value: 310000,
      includeInNetWorth: true,
    };
    let savedId: string;

    it(
      'writes a record through useRepository()`s repository and reads it back',
      async () => {
        const saved = await saveAsset(repository, asset, Date.now());
        savedId = saved.id;
        written.push(savedId);

        expect(saved.name).toBe(asset.name);
        expect(saved.value).toBe(asset.value);

        const all = await listAssets(repository);
        const found = all.find((candidate) => candidate.id === savedId);
        expect(found).toEqual({ id: savedId, ...asset });
      },
      NETWORK_MS,
    );

    it(
      'stores ciphertext in Firestore and no plaintext domain field',
      async () => {
        const { status, body } = await rawDocument(
          idToken,
          `users/${userId}/${COLLECTIONS[0]}/${savedId}`,
        );
        expect(status).toBe(200);

        const fields = (body as { fields: Record<string, unknown> }).fields;
        // Exactly what `hasOnlyRecordFields` permits, and nothing else.
        expect(Object.keys(fields).sort()).toEqual(
          ['deletedAt', 'enc', 'id', 'revision', 'updatedAt'].sort(),
        );

        const serialised = JSON.stringify(body);
        for (const secret of ['Sovereign gold bonds', 'gold', '310000', 'includeInNetWorth']) {
          expect(serialised).not.toContain(secret);
        }

        const envelope = (
          fields.enc as { mapValue: { fields: Record<string, { stringValue?: string }> } }
        ).mapValue.fields;
        expect(Object.keys(envelope).sort()).toEqual(['alg', 'ct', 'iv', 'v'].sort());
        expect(envelope.alg.stringValue).toBe('AES-GCM');
      },
      NETWORK_MS,
    );

    it(
      'updates the record and advances the revision',
      async () => {
        const updated = await saveAsset(
          repository,
          { ...asset, id: savedId, value: 325000 },
          Date.now(),
        );
        expect(updated.value).toBe(325000);

        const all = await listAssets(repository);
        expect(all.find((candidate) => candidate.id === savedId)?.value).toBe(325000);
      },
      NETWORK_MS,
    );

    it(
      'tombstones the record through the repository',
      async () => {
        await inner.delete(COLLECTIONS[0], savedId, Date.now());
        const all = await listAssets(repository);
        expect(all.find((candidate) => candidate.id === savedId)).toBeUndefined();
      },
      NETWORK_MS,
    );
  });

  describe('the real Security Rules', () => {
    it(
      'denies an unauthenticated read',
      async () => {
        const project = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
        const response = await fetch(
          `https://firestore.googleapis.com/v1/projects/${project}` +
            `/databases/(default)/documents/users/${userId}/${COLLECTIONS[0]}` +
            `?key=${process.env.EXPO_PUBLIC_FIREBASE_API_KEY}`,
        );
        expect(response.status).toBe(403);
      },
      NETWORK_MS,
    );

    it(
      'denies reading another user',
      async () => {
        const { status } = await rawDocument(idToken, `users/not-${userId}/${COLLECTIONS[0]}/x`);
        expect(status).toBe(403);
      },
      NETWORK_MS,
    );

    it(
      'rejects a plaintext domain record',
      async () => {
        const { status, reason } = await rawWrite(
          idToken,
          `users/${userId}/${COLLECTIONS[0]}/plaintext-probe`,
          {
            id: { stringValue: 'plaintext-probe' },
            revision: { integerValue: '1' },
            name: { stringValue: 'Sovereign gold bonds' },
            value: { integerValue: '310000' },
          },
        );
        expect(status).toBe(403);
        expect(reason).toBe('PERMISSION_DENIED');
      },
      NETWORK_MS,
    );

    it(
      'rejects a reserved authorization field',
      async () => {
        const { status } = await rawWrite(
          idToken,
          `users/${userId}/${COLLECTIONS[0]}/reserved-probe`,
          {
            id: { stringValue: 'reserved-probe' },
            revision: { integerValue: '1' },
            role: { stringValue: 'admin' },
          },
        );
        expect(status).toBe(403);
      },
      NETWORK_MS,
    );

    it(
      'keeps the recovery-code and device-verification paths closed to their owner',
      async () => {
        expect((await rawDocument(idToken, `users/${userId}/recoveryCodes/x`)).status).toBe(403);
        expect((await rawDocument(idToken, `users/${userId}/deviceVerifications/x`)).status).toBe(
          403,
        );
      },
      NETWORK_MS,
    );
  });

  describe('recovery escrow round trip', () => {
    const RECOVERY_CODE = 'ABCD-EFGH-JKLM';
    const context = { userId: '', appName: APP_NAME };

    it(
      'escrows the key in Firestore, carrying no plaintext key material',
      async () => {
        context.userId = userId;
        const envelope = await createRecoveryEscrow(
          dataKey,
          RECOVERY_CODE,
          cryptoService,
          context,
        );
        await services.escrowStore.save(toRecoveryEscrowDocument('current', envelope));

        const { status, body } = await rawDocument(
          idToken,
          `users/${userId}/recoveryEscrow/current`,
        );
        expect(status).toBe(200);

        const fields = (body as { fields: Record<string, unknown> }).fields;
        expect(Object.keys(fields)).toContain('wrappedKey');
        expect(Object.keys(fields)).not.toContain('recoveryCode');

        // Neither the key nor the code is recoverable from the document.
        const serialised = JSON.stringify(body);
        expect(serialised).not.toContain(RECOVERY_CODE);
        expect(serialised).not.toContain(Buffer.from(dataKey).toString('base64'));
      },
      NETWORK_MS,
    );

    it(
      'recovers the key from Firestore and decrypts a real record with it',
      async () => {
        const stored = await services.escrowStore.load();
        const recovered = await openRecoveryEscrow(
          fromRecoveryEscrowDocument(stored),
          RECOVERY_CODE,
          cryptoService,
          context,
        );
        expect(Buffer.from(recovered).equals(Buffer.from(dataKey))).toBe(true);

        // The recovered key opens a record written earlier under the original.
        const fresh = await saveAsset(
          repository,
          { name: 'Recovery probe', category: 'gold', value: 1, includeInNetWorth: true },
          Date.now(),
        );
        written.push(fresh.id);

        const viaRecovered = repositoryForConsumer(
          new EncryptingRepository({
            inner,
            cipher: recordCipher,
            dataKey: async () => recovered,
            userId,
            appName: APP_NAME,
          }),
        );
        const readBack = await viaRecovered.get(COLLECTIONS[0], fresh.id);
        expect((readBack as unknown as { name: string }).name).toBe('Recovery probe');
      },
      NETWORK_MS,
    );

    it(
      'refuses a wrong recovery code and a tampered envelope',
      async () => {
        const stored = await services.escrowStore.load();
        await expect(
          openRecoveryEscrow(
            fromRecoveryEscrowDocument(stored),
            'ZZZZ-ZZZZ-ZZZZ',
            cryptoService,
            context,
          ),
        ).rejects.toThrow();

        const tampered = fromRecoveryEscrowDocument(stored);
        const broken = {
          ...tampered,
          wrappedKey: { ...tampered.wrappedKey, ciphertext: 'AAAA' + tampered.wrappedKey.ciphertext.slice(4) },
        };
        await expect(
          openRecoveryEscrow(broken, RECOVERY_CODE, cryptoService, context),
        ).rejects.toThrow();
      },
      NETWORK_MS,
    );
  });

  describe('trusted-device pairing over the real relay', () => {
    /**
     * The new device's custody, as an object satisfying `KeyCustody`.
     *
     * This is the interface, not `createKeyCustody` — the protection-tier check
     * lives in that factory and is deliberately not satisfiable by a Node
     * process, so nothing here claims a tier it does not have. What is being
     * validated is the pairing protocol over real Firestore; that a real
     * keystore holds the result is covered on device by the Hermes self-test.
     * `completePairing`'s own guard (refusing when a key is already present) is
     * still exercised against this.
     */
    function harnessCustody(): KeyCustody & { stored: Uint8Array | null } {
      const state = { stored: null as Uint8Array | null };
      return {
        get stored() {
          return state.stored;
        },
        async status() {
          return state.stored === null ? 'absent' : 'present';
        },
        async load() {
          return state.stored;
        },
        async store(key: Uint8Array) {
          state.stored = key;
        },
        async clear() {
          state.stored = null;
        },
      };
    }

    let sessionId: string;

    it(
      'runs the whole protocol between two devices on one account',
      async () => {
        const relay = services.pairingRelay;
        // Entropy is injected, as everywhere else in this package: left to itself
        // `ecdh` reaches for a WebCrypto random source React Native lacks.
        const agreement = new P256KeyAgreement(randomBytes);
        const now = () => Date.now();

        // --- trusted device: publish a commitment, and only a commitment ---
        const offer = createPairingOffer({
          appName: APP_NAME,
          now: now(),
          randomBytes,
          agreement,
        });
        sessionId = offer.session.id;
        pairingSessions.push(sessionId);
        await relay.create(offer.session);

        const afterOffer = await rawDocument(
          idToken,
          `users/${userId}/pairing/${sessionId}`,
        );
        expect(afterOffer.status).toBe(200);
        const offerFields = (afterOffer.body as { fields: Record<string, unknown> }).fields;
        expect(Object.keys(offerFields)).toContain('commitment');
        // The trusted device has not revealed. Publishing the key alongside the
        // commitment would let a relay grind a pair against it.
        expect(offerFields.initiatorPublicKey).toBeUndefined();
        expect(offerFields.wrapped).toBeUndefined();

        // --- new device: join and publish its own key ---
        const loadedForAccept = await relay.load(sessionId);
        const acceptance = acceptPairing({
          session: loadedForAccept,
          now: now(),
          agreement,
        });
        await relay.accept(sessionId, acceptance.responderPublicKey);

        // --- trusted device: open the commitment ---
        await relay.reveal(sessionId, Buffer.from(offer.keyPair.publicKey).toString('base64'));

        // --- both derive; the digits must match ---
        const session = await relay.load(sessionId);
        const initiatorSide = derivePairingAgreement({
          session,
          privateKey: offer.keyPair.privateKey,
          userId,
          now: now(),
          agreement,
        });
        const responderSide = derivePairingAgreement({
          session,
          privateKey: acceptance.keyPair.privateKey,
          userId,
          now: now(),
          agreement,
        });
        expect(responderSide.code).toBe(initiatorSide.code);
        expect(initiatorSide.code).toMatch(/^\d{3}-\d{3}$/);
        expect(Buffer.from(responderSide.transportKey)).toEqual(
          Buffer.from(initiatorSide.transportKey),
        );

        // --- a person compares the digits. That decision stays on the device:
        //     nothing is written to the relay to record it. ---
        const wrapped = await wrapDataKeyForPairing({
          dataKey,
          transportKey: initiatorSide.transportKey,
          context: { userId, appName: APP_NAME, sessionId },
          cipher: recordCipher,
        });
        await relay.confirm(sessionId, wrapped);

        // --- new device: unwrap and take custody ---
        const custody = harnessCustody();
        const adopted = await completePairing({
          session: await relay.load(sessionId),
          transportKey: responderSide.transportKey,
          context: { userId, appName: APP_NAME, sessionId },
          cipher: recordCipher,
          custody,
          now: now(),
        });
        expect(Buffer.from(adopted)).toEqual(Buffer.from(dataKey));
        expect(custody.stored).not.toBeNull();

        await relay.consume(sessionId);
      },
      NETWORK_MS,
    );

    it(
      'left no private key, transport key, data key or verdict in Firestore',
      async () => {
        const { body } = await rawDocument(idToken, `users/${userId}/pairing/${sessionId}`);
        const fields = (body as { fields: Record<string, unknown> }).fields;

        // Exactly the protocol material the rules allow, and nothing else.
        expect(Object.keys(fields).sort()).toEqual(
          [
            'id',
            'version',
            'appName',
            'commitment',
            'createdAt',
            'updatedAt',
            'expiresAt',
            'initiatorPublicKey',
            'responderPublicKey',
            'wrapped',
            'consumedAt',
          ].sort(),
        );

        // No verdict, under any of the names the architecture guard bans.
        for (const banned of ['verified', 'isVerified', 'approved', 'status', 'pairingStatus']) {
          expect(Object.keys(fields)).not.toContain(banned);
        }

        const serialised = JSON.stringify(body);
        expect(serialised).not.toContain(Buffer.from(dataKey).toString('base64'));
      },
      NETWORK_MS,
    );

    it(
      'refuses every further write once the session is consumed',
      async () => {
        // Driven through the relay the application actually uses, so what is
        // being refused is a real client call and not a hand-built REST body.
        const relay = services.pairingRelay;
        await expect(relay.accept(sessionId, 'AAAA')).rejects.toThrow();
        await expect(relay.consume(sessionId)).rejects.toThrow();
      },
      NETWORK_MS,
    );

    it(
      'refuses an offer whose expiry has already passed',
      async () => {
        const { status } = await rawWrite(idToken, `users/${userId}/pairing/expired-probe`, {
          id: { stringValue: 'expired-probe' },
          version: { integerValue: '1' },
          appName: { stringValue: APP_NAME },
          commitment: { stringValue: 'AAAA' },
          expiresAt: { integerValue: String(Date.now() - 60_000) },
        });
        expect(status).toBe(403);
      },
      NETWORK_MS,
    );
  });
});
