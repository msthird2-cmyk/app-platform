import { describe, expect, it } from 'vitest';
import { fromBase64, toBase64 } from '../src/crypto/base64';
import { additionalData } from '../src/crypto/envelope';
import { utf8Decode } from '../src/crypto/utf8';
import { SecurityErrorCode } from '../src/errors';
import { createKeyCustody, type CustodyStorage } from '../src/keyCustody';
import { MIN_KDF_ITERATIONS } from '../src/kdfPolicy';
import type { ProtectionTier } from '../src/protectionTier';
import {
  RECOVERY_ESCROW_PURPOSE,
  RECOVERY_ESCROW_VERSION,
  createRecoveryEscrow,
  openRecoveryEscrow,
  recoverDataKey,
  type RecoveryEscrowEnvelope,
} from '../src/recoveryEscrow';
import { WebCryptoService } from '../src/services/WebCryptoService';
import type { EncryptedPayload, EncryptionContext } from '../src/types/crypto';

/**
 * The minimum cost keeps the suite fast; production uses the policy default.
 * Nothing here lowers the policy — `MIN_KDF_ITERATIONS` is the same floor the
 * read path enforces.
 */
const crypto = new WebCryptoService(MIN_KDF_ITERATIONS);

const CONTEXT: EncryptionContext = { userId: 'alice-uid', appName: 'networth' };

/** Deterministic, obviously fake, and never zero. */
const TEST_DEK = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 13) % 256);
const CODE = 'K7QM-2XPD-9RTF';

class Fake implements CustodyStorage {
  readonly entries = new Map<string, string>();
  constructor(readonly protection: ProtectionTier = 'os-keystore') {}
  async get(key: string) {
    return this.entries.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.entries.set(key, value);
  }
  async remove(key: string) {
    this.entries.delete(key);
  }
}

function tamper(text: string): string {
  // Flip one base64 symbol to something else in the alphabet.
  const first = text[0] === 'A' ? 'B' : 'A';
  return first + text.slice(1);
}

function withPayload(
  envelope: RecoveryEscrowEnvelope,
  changes: Partial<EncryptedPayload>,
): RecoveryEscrowEnvelope {
  return { ...envelope, wrappedKey: { ...envelope.wrappedKey, ...changes } };
}

describe('recovery escrow — construction', () => {
  it('wraps and unwraps a data encryption key', async () => {
    const escrow = await createRecoveryEscrow(TEST_DEK, CODE, crypto, CONTEXT);
    expect(escrow.version).toBe(RECOVERY_ESCROW_VERSION);
    const opened = await openRecoveryEscrow(escrow, CODE, crypto, CONTEXT);
    expect(Array.from(opened)).toEqual(Array.from(TEST_DEK));
  });

  it('never puts the key, or the code, anywhere in the envelope', async () => {
    const escrow = await createRecoveryEscrow(TEST_DEK, CODE, crypto, CONTEXT);
    const serialised = JSON.stringify(escrow);
    expect(serialised).not.toContain(toBase64(TEST_DEK));
    expect(serialised).not.toContain(CODE);
    expect(serialised).not.toContain('K7QM2XPD9RTF');
    // And nothing that could verify a guess without paying for the AEAD.
    expect(Object.keys(escrow).sort()).toEqual(['version', 'wrappedKey']);
    expect(Object.keys(escrow.wrappedKey).sort()).toEqual([
      'algorithm',
      'ciphertext',
      'iterations',
      'iv',
      'salt',
      'version',
    ]);
  });

  it('produces a different envelope every time for the same inputs', async () => {
    const a = await createRecoveryEscrow(TEST_DEK, CODE, crypto, CONTEXT);
    const b = await createRecoveryEscrow(TEST_DEK, CODE, crypto, CONTEXT);
    expect(a.wrappedKey.salt).not.toEqual(b.wrappedKey.salt);
    expect(a.wrappedKey.iv).not.toEqual(b.wrappedKey.iv);
    expect(a.wrappedKey.ciphertext).not.toEqual(b.wrappedKey.ciphertext);
    // Both still open to the same key.
    for (const escrow of [a, b]) {
      expect(Array.from(await openRecoveryEscrow(escrow, CODE, crypto, CONTEXT))).toEqual(
        Array.from(TEST_DEK),
      );
    }
  });

  it('accepts the code back in any spacing or case', async () => {
    const escrow = await createRecoveryEscrow(TEST_DEK, CODE, crypto, CONTEXT);
    for (const typed of ['k7qm-2xpd-9rtf', 'K7QM 2XPD 9RTF', 'K7QM2XPD9RTF', ' k7qm2xpd9rtf ']) {
      expect(
        Array.from(await openRecoveryEscrow(escrow, typed, crypto, CONTEXT)),
        typed,
      ).toEqual(Array.from(TEST_DEK));
    }
  });

  it('refuses to escrow anything that is not a key', async () => {
    const cases: Uint8Array[] = [
      new Uint8Array(16),
      new Uint8Array(31),
      new Uint8Array(33),
      new Uint8Array(32), // all zero
    ];
    for (const key of cases) {
      await expect(
        createRecoveryEscrow(key, CODE, crypto, CONTEXT),
        String(key.length),
      ).rejects.toMatchObject({ code: SecurityErrorCode.RECOVERY_ESCROW_INVALID });
    }
  });

  it('refuses a malformed recovery code before deriving anything', async () => {
    for (const bad of ['', 'too-short', 'K7QM-2XPD-9RT', 'K7QM-2XPD-9RTFF', 'IOU1-2XPD-9RTF']) {
      await expect(
        createRecoveryEscrow(TEST_DEK, bad, crypto, CONTEXT),
        bad,
      ).rejects.toMatchObject({ code: SecurityErrorCode.RECOVERY_CODE_INVALID });
    }
  });
});

describe('recovery escrow — a wrong code cannot produce a key', () => {
  it('fails the authentication tag for a different code', async () => {
    const escrow = await createRecoveryEscrow(TEST_DEK, CODE, crypto, CONTEXT);
    await expect(
      openRecoveryEscrow(escrow, 'AAAA-BBBB-CCCC', crypto, CONTEXT),
    ).rejects.toMatchObject({ code: SecurityErrorCode.DECRYPTION_FAILED });
  });

  it('fails for a code differing in a single symbol', async () => {
    const escrow = await createRecoveryEscrow(TEST_DEK, CODE, crypto, CONTEXT);
    await expect(
      openRecoveryEscrow(escrow, 'K7QM-2XPD-9RTG', crypto, CONTEXT),
    ).rejects.toMatchObject({ code: SecurityErrorCode.DECRYPTION_FAILED });
  });
});

describe('recovery escrow — tampering', () => {
  it('rejects a modified ciphertext, nonce or salt', async () => {
    const escrow = await createRecoveryEscrow(TEST_DEK, CODE, crypto, CONTEXT);
    const mutations: Array<[string, RecoveryEscrowEnvelope]> = [
      ['ciphertext', withPayload(escrow, { ciphertext: tamper(escrow.wrappedKey.ciphertext) })],
      ['iv', withPayload(escrow, { iv: tamper(escrow.wrappedKey.iv) })],
      ['salt', withPayload(escrow, { salt: tamper(escrow.wrappedKey.salt) })],
    ];
    for (const [name, mutated] of mutations) {
      await expect(
        openRecoveryEscrow(mutated, CODE, crypto, CONTEXT),
        name,
      ).rejects.toMatchObject({ code: SecurityErrorCode.DECRYPTION_FAILED });
    }
  });

  it('rejects a modified KDF cost, because the tag covers it', async () => {
    const escrow = await createRecoveryEscrow(TEST_DEK, CODE, crypto, CONTEXT);
    // Still inside policy bounds, so this gets past the parameter gate and has
    // to be caught by the authenticated data instead.
    const mutated = withPayload(escrow, { iterations: MIN_KDF_ITERATIONS + 1 });
    await expect(openRecoveryEscrow(mutated, CODE, crypto, CONTEXT)).rejects.toMatchObject({
      code: SecurityErrorCode.DECRYPTION_FAILED,
    });
  });

  it('rejects a KDF cost outside policy before deriving anything', async () => {
    const escrow = await createRecoveryEscrow(TEST_DEK, CODE, crypto, CONTEXT);
    for (const iterations of [0, 1, 99_999, 1_000_001, 1.5, Number.NaN]) {
      const mutated = withPayload(escrow, { iterations });
      await expect(
        openRecoveryEscrow(mutated, CODE, crypto, CONTEXT),
        String(iterations),
      ).rejects.toMatchObject({ code: SecurityErrorCode.ENCRYPTION_PARAMETERS_INVALID });
    }
  });

  it('rejects an unsupported envelope version', async () => {
    const escrow = await createRecoveryEscrow(TEST_DEK, CODE, crypto, CONTEXT);
    for (const version of [0, 2, 99]) {
      await expect(
        openRecoveryEscrow({ ...escrow, version }, CODE, crypto, CONTEXT),
        String(version),
      ).rejects.toMatchObject({ code: SecurityErrorCode.ENCRYPTION_VERSION_UNSUPPORTED });
    }
  });

  it('rejects an unsupported payload version and algorithm', async () => {
    const escrow = await createRecoveryEscrow(TEST_DEK, CODE, crypto, CONTEXT);
    await expect(
      openRecoveryEscrow(withPayload(escrow, { version: 2 as 1 }), CODE, crypto, CONTEXT),
    ).rejects.toMatchObject({ code: SecurityErrorCode.ENCRYPTION_VERSION_UNSUPPORTED });
    await expect(
      openRecoveryEscrow(
        withPayload(escrow, { algorithm: 'AES-CBC' as 'AES-GCM' }),
        CODE,
        crypto,
        CONTEXT,
      ),
    ).rejects.toMatchObject({ code: SecurityErrorCode.ENCRYPTION_ALGORITHM_UNSUPPORTED });
  });

  it('rejects a malformed envelope without deriving a key', async () => {
    const escrow = await createRecoveryEscrow(TEST_DEK, CODE, crypto, CONTEXT);
    const malformed: unknown[] = [
      null,
      undefined,
      'a string',
      42,
      [],
      {},
      { version: RECOVERY_ESCROW_VERSION },
      { version: RECOVERY_ESCROW_VERSION, wrappedKey: null },
      { version: RECOVERY_ESCROW_VERSION, wrappedKey: 'nope' },
      { version: RECOVERY_ESCROW_VERSION, wrappedKey: {} },
      withPayload(escrow, { ciphertext: 42 as unknown as string }),
      withPayload(escrow, { iv: undefined as unknown as string }),
      withPayload(escrow, { iterations: 'lots' as unknown as number }),
    ];
    for (const value of malformed) {
      await expect(
        openRecoveryEscrow(value, CODE, crypto, CONTEXT),
        JSON.stringify(value) ?? String(value),
      ).rejects.toThrow();
    }
  });
});

describe('recovery escrow — context binding', () => {
  it('refuses an envelope escrowed for a different user or application', async () => {
    const escrow = await createRecoveryEscrow(TEST_DEK, CODE, crypto, CONTEXT);
    for (const context of [
      { userId: 'bob-uid', appName: 'networth' },
      { userId: 'alice-uid', appName: 'expense' },
    ]) {
      await expect(
        openRecoveryEscrow(escrow, CODE, crypto, context),
        JSON.stringify(context),
      ).rejects.toMatchObject({ code: SecurityErrorCode.DECRYPTION_FAILED });
    }
  });

  it('separates the escrow KDF domain from every other use of the same code', async () => {
    // This is the architecture's requirement that a recovery code used to
    // derive an encryption key keeps that purpose separate from credential
    // verification. An ordinary payload encrypted under the very same code is
    // a different domain, and neither side can open the other.
    const escrow = await createRecoveryEscrow(TEST_DEK, CODE, crypto, CONTEXT);
    const ordinary = await crypto.encrypt(toBase64(TEST_DEK), CODE, CONTEXT);

    await expect(crypto.decrypt(escrow.wrappedKey, CODE, CONTEXT)).rejects.toMatchObject({
      code: SecurityErrorCode.DECRYPTION_FAILED,
    });
    await expect(
      openRecoveryEscrow(
        { version: RECOVERY_ESCROW_VERSION, wrappedKey: ordinary },
        CODE,
        crypto,
        CONTEXT,
      ),
    ).rejects.toMatchObject({ code: SecurityErrorCode.DECRYPTION_FAILED });
  });

  it('leaves additional data byte-identical when no purpose is given', () => {
    // Adding `purpose` must not have invalidated a single payload already
    // written, so the serialised form without one has to be exactly what it was.
    const before = '{"v":1,"alg":"AES-GCM","kdf":"PBKDF2-SHA256","it":210000,'
      + '"uid":"alice-uid","app":"networth"}';
    expect(utf8Decode(additionalData(CONTEXT, 210_000, 1))).toBe(before);
    expect(utf8Decode(additionalData({ ...CONTEXT, purpose: undefined }, 210_000, 1))).toBe(before);
    expect(utf8Decode(additionalData({ ...CONTEXT, purpose: RECOVERY_ESCROW_PURPOSE }, 210_000, 1)))
      .toBe(before.slice(0, -1) + `,"pur":"${RECOVERY_ESCROW_PURPOSE}"}`);
  });

  it('rejects a wrapped value that opens to something that is not a key', async () => {
    // The tag verifies — this really was written by us — and it is still not
    // accepted, because a 16-byte value is not an AES-256 key.
    const shortKey = await crypto.encrypt(toBase64(new Uint8Array(16).fill(9)), CODE, {
      ...CONTEXT,
      purpose: RECOVERY_ESCROW_PURPOSE,
    });
    await expect(
      openRecoveryEscrow(
        { version: RECOVERY_ESCROW_VERSION, wrappedKey: shortKey },
        CODE,
        crypto,
        CONTEXT,
      ),
    ).rejects.toMatchObject({ code: SecurityErrorCode.RECOVERY_ESCROW_INVALID });

    const zeroKey = await crypto.encrypt(toBase64(new Uint8Array(32)), CODE, {
      ...CONTEXT,
      purpose: RECOVERY_ESCROW_PURPOSE,
    });
    await expect(
      openRecoveryEscrow(
        { version: RECOVERY_ESCROW_VERSION, wrappedKey: zeroKey },
        CODE,
        crypto,
        CONTEXT,
      ),
    ).rejects.toMatchObject({ code: SecurityErrorCode.RECOVERY_ESCROW_INVALID });
  });
});

describe('zero-trusted-device recovery', () => {
  async function scenario() {
    const storage = new Fake();
    const custody = createKeyCustody(storage);
    const escrow = await createRecoveryEscrow(TEST_DEK, CODE, crypto, CONTEXT);
    // The user had the key on a device, and that device is gone.
    await custody.store(TEST_DEK);
    await custody.clear();
    expect(await custody.status()).toBe('absent');
    return { storage, custody, escrow };
  }

  it('restores the key to custody from the recovery code alone', async () => {
    const { storage, custody, escrow } = await scenario();
    const recovered = await recoverDataKey({
      escrow,
      recoveryCode: CODE,
      crypto,
      context: CONTEXT,
      custody,
    });

    expect(Array.from(recovered)).toEqual(Array.from(TEST_DEK));
    expect(await custody.status()).toBe('present');
    expect(Array.from((await custody.load()) as Uint8Array)).toEqual(Array.from(TEST_DEK));

    // It went through Gate 2 custody and nowhere else.
    expect([...storage.entries.keys()]).toEqual(['platform.dek.v1']);
  });

  it('leaves custody empty when the recovery code is wrong', async () => {
    const { custody, escrow } = await scenario();
    await expect(
      recoverDataKey({
        escrow,
        recoveryCode: 'AAAA-BBBB-CCCC',
        crypto,
        context: CONTEXT,
        custody,
      }),
    ).rejects.toMatchObject({ code: SecurityErrorCode.DECRYPTION_FAILED });
    expect(await custody.status()).toBe('absent');
    expect(await custody.load()).toBeNull();
  });

  it('leaves custody empty when the escrow is corrupt', async () => {
    const { custody, escrow } = await scenario();
    const corrupt = withPayload(escrow, { ciphertext: tamper(escrow.wrappedKey.ciphertext) });
    await expect(
      recoverDataKey({ escrow: corrupt, recoveryCode: CODE, crypto, context: CONTEXT, custody }),
    ).rejects.toThrow();
    expect(await custody.status()).toBe('absent');
  });

  it('never generates a replacement key when there is no escrow', async () => {
    const { storage, custody } = await scenario();
    for (const escrow of [null, undefined]) {
      await expect(
        recoverDataKey({ escrow, recoveryCode: CODE, crypto, context: CONTEXT, custody }),
      ).rejects.toMatchObject({ code: SecurityErrorCode.RECOVERY_ESCROW_MISSING });
    }
    expect(await custody.status()).toBe('absent');
    expect(storage.entries.size).toBe(0);
  });

  it('refuses to recover into storage weaker than the required tier', async () => {
    // Gate 2's guarantee is not relaxed just because this is a recovery path.
    expect(() => createKeyCustody(new Fake('memory'))).toThrowError(
      expect.objectContaining({ code: SecurityErrorCode.SECURE_STORAGE_UNAVAILABLE }),
    );
  });

  it('round-trips a key that custody itself produced the envelope for', async () => {
    // End to end through both gates: what custody stores is what escrow
    // restores, byte for byte.
    const storage = new Fake();
    const custody = createKeyCustody(storage);
    await custody.store(TEST_DEK);
    const held = (await custody.load()) as Uint8Array;
    const escrow = await createRecoveryEscrow(held, CODE, crypto, CONTEXT);
    await custody.clear();

    await recoverDataKey({ escrow, recoveryCode: CODE, crypto, context: CONTEXT, custody });
    const restored = (await custody.load()) as Uint8Array;
    expect(Array.from(restored)).toEqual(Array.from(TEST_DEK));
    expect(Array.from(fromBase64(toBase64(restored)))).toEqual(Array.from(held));
  });
});
