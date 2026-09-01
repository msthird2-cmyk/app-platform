import { describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { WebCryptoService } from '../src/services/WebCryptoService';
import {
  DATA_KEY_WRAPPER_PURPOSE,
  DATA_KEY_WRAPPER_VERSION,
  assertWrappedDataKey,
  changeDataKeyPassphrase,
  unwrapDataKey,
  wrapDataKey,
} from '../src/dataKeyWrapper';
import { createRecoveryEscrow } from '../src/recoveryEscrow';
import { SecurityErrorCode } from '../src/errors';

const crypto = new WebCryptoService(100_000);
const DEK = Uint8Array.from({ length: 32 }, (_, i) => (i * 13 + 7) % 256);
const OTHER_DEK = Uint8Array.from({ length: 32 }, (_, i) => (i * 5 + 1) % 256);
const PASSPHRASE = 'correct1horse-battery';
const NEXT_PASSPHRASE = 'staple9tortoise-lantern';
const context = { userId: 'user-1', appName: 'Net Worth' };

function randomBytes(length: number): Uint8Array {
  return webcrypto.getRandomValues(new Uint8Array(length));
}

describe('wrapping the data key', () => {
  it('unwraps to byte-identical key material', async () => {
    const wrapper = await wrapDataKey(DEK, PASSPHRASE, crypto, context);
    const opened = await unwrapDataKey(wrapper, PASSPHRASE, crypto, context);
    expect(Buffer.from(opened)).toEqual(Buffer.from(DEK));
  });

  it('carries neither the key nor the passphrase', async () => {
    const wrapper = await wrapDataKey(DEK, PASSPHRASE, crypto, context);
    const serialised = JSON.stringify(wrapper);

    expect(serialised).not.toContain(PASSPHRASE);
    expect(serialised).not.toContain(Buffer.from(DEK).toString('base64'));
    expect(serialised).not.toContain(Buffer.from(DEK).toString('hex'));
    // Ciphertext and non-secret KDF metadata, and nothing else. In particular
    // no digest or verifier that would let a guess be tested without the AEAD.
    expect(Object.keys(wrapper).sort()).toEqual(['version', 'wrappedKey']);
    expect(Object.keys(wrapper.wrappedKey).sort()).toEqual(
      ['algorithm', 'ciphertext', 'iterations', 'iv', 'salt', 'version'].sort(),
    );
  });

  it('refuses a weak passphrase before deriving anything', async () => {
    await expect(wrapDataKey(DEK, 'x', crypto, context)).rejects.toMatchObject({
      code: SecurityErrorCode.PASSPHRASE_TOO_WEAK,
    });
  });

  it('refuses a key that is not a key', async () => {
    const zero = new Uint8Array(32);
    await expect(wrapDataKey(zero, PASSPHRASE, crypto, context)).rejects.toMatchObject({
      code: SecurityErrorCode.DATA_KEY_WRAPPER_INVALID,
    });
    await expect(
      wrapDataKey(new Uint8Array(16), PASSPHRASE, crypto, context),
    ).rejects.toMatchObject({ code: SecurityErrorCode.DATA_KEY_WRAPPER_INVALID });
  });

  it('produces a different wrapper every time, from a fresh salt and iv', async () => {
    const first = await wrapDataKey(DEK, PASSPHRASE, crypto, context);
    const second = await wrapDataKey(DEK, PASSPHRASE, crypto, context);
    expect(first.wrappedKey.salt).not.toBe(second.wrappedKey.salt);
    expect(first.wrappedKey.iv).not.toBe(second.wrappedKey.iv);
    expect(first.wrappedKey.ciphertext).not.toBe(second.wrappedKey.ciphertext);
  });
});

describe('opening it with the wrong thing', () => {
  it('refuses a wrong passphrase', async () => {
    const wrapper = await wrapDataKey(DEK, PASSPHRASE, crypto, context);
    await expect(
      unwrapDataKey(wrapper, 'wrong1horse-battery', crypto, context),
    ).rejects.toMatchObject({ code: SecurityErrorCode.DECRYPTION_FAILED });
  });

  it('refuses tampered ciphertext, iv and salt alike', async () => {
    const wrapper = await wrapDataKey(DEK, PASSPHRASE, crypto, context);
    const flip = (value: string) => (value.startsWith('A') ? `B${value.slice(1)}` : `A${value.slice(1)}`);

    for (const field of ['ciphertext', 'iv', 'salt'] as const) {
      const tampered = {
        ...wrapper,
        wrappedKey: { ...wrapper.wrappedKey, [field]: flip(wrapper.wrappedKey[field]) },
      };
      await expect(unwrapDataKey(tampered, PASSPHRASE, crypto, context)).rejects.toThrow();
    }
  });

  it('refuses a changed iteration count, which is covered by the tag', async () => {
    const wrapper = await wrapDataKey(DEK, PASSPHRASE, crypto, context);
    const tampered = {
      ...wrapper,
      wrappedKey: { ...wrapper.wrappedKey, iterations: 100_001 },
    };
    await expect(unwrapDataKey(tampered, PASSPHRASE, crypto, context)).rejects.toThrow();
  });

  it('refuses a wrapper bound to another user or another application', async () => {
    const wrapper = await wrapDataKey(DEK, PASSPHRASE, crypto, context);

    await expect(
      unwrapDataKey(wrapper, PASSPHRASE, crypto, { ...context, userId: 'someone-else' }),
    ).rejects.toMatchObject({ code: SecurityErrorCode.DECRYPTION_FAILED });
    await expect(
      unwrapDataKey(wrapper, PASSPHRASE, crypto, { ...context, appName: 'Expense' }),
    ).rejects.toMatchObject({ code: SecurityErrorCode.DECRYPTION_FAILED });
  });

  it('cannot be opened as a recovery escrow, nor an escrow as a wrapper', async () => {
    // Domain separation. The purpose is inside the authenticated data, so one
    // envelope replayed as the other fails the tag rather than yielding a key.
    const wrapper = await wrapDataKey(DEK, PASSPHRASE, crypto, context);
    const escrow = await createRecoveryEscrow(DEK, 'ABCD-EFGH-JKLM', crypto, context);

    await expect(
      unwrapDataKey({ version: 1, wrappedKey: escrow.wrappedKey }, PASSPHRASE, crypto, context),
    ).rejects.toThrow();
    // And the reverse: the wrapper's payload does not open under escrow rules.
    await expect(
      crypto.decrypt(wrapper.wrappedKey, PASSPHRASE, {
        ...context,
        purpose: 'recovery-escrow.v1',
      }),
    ).rejects.toThrow();
  });
});

describe('format validation', () => {
  it('rejects an unsupported version distinctly from a corrupt document', async () => {
    const wrapper = await wrapDataKey(DEK, PASSPHRASE, crypto, context);
    expect(() => assertWrappedDataKey({ ...wrapper, version: 2 })).toThrow(
      expect.objectContaining({ code: SecurityErrorCode.ENCRYPTION_VERSION_UNSUPPORTED }),
    );
    expect(DATA_KEY_WRAPPER_VERSION).toBe(1);
  });

  it('fails closed on anything malformed', () => {
    for (const bad of [null, undefined, 0, 'wrapper', [], {}, { version: 1 }, { version: 1, wrappedKey: {} }]) {
      expect(() => assertWrappedDataKey(bad)).toThrow();
    }
  });

  it('rejects a KDF cost outside the accepted range before deriving', async () => {
    const wrapper = await wrapDataKey(DEK, PASSPHRASE, crypto, context);
    const hostile = {
      ...wrapper,
      wrappedKey: { ...wrapper.wrappedKey, iterations: 1_000_000_000 },
    };
    // Refused by the shared envelope policy, so a hostile document cannot buy
    // a billion rounds of work on this device.
    expect(() => assertWrappedDataKey(hostile)).toThrow();
  });

  it('names a purpose distinct from every other envelope', () => {
    expect(DATA_KEY_WRAPPER_PURPOSE).toBe('data-key-wrapper.v1');
  });
});

describe('changing the passphrase', () => {
  it('keeps the same key, so no record needs re-encrypting', async () => {
    const original = await wrapDataKey(DEK, PASSPHRASE, crypto, context);
    const rewrapped = await changeDataKeyPassphrase(
      original,
      PASSPHRASE,
      NEXT_PASSPHRASE,
      crypto,
      context,
    );

    const opened = await unwrapDataKey(rewrapped, NEXT_PASSPHRASE, crypto, context);
    // The identical 32 bytes. Every record encrypted under them still opens,
    // which is the whole reason the passphrase wraps the key and not the data.
    expect(Buffer.from(opened)).toEqual(Buffer.from(DEK));
  });

  it('stops the old passphrase working', async () => {
    const original = await wrapDataKey(DEK, PASSPHRASE, crypto, context);
    const rewrapped = await changeDataKeyPassphrase(
      original,
      PASSPHRASE,
      NEXT_PASSPHRASE,
      crypto,
      context,
    );

    await expect(unwrapDataKey(rewrapped, PASSPHRASE, crypto, context)).rejects.toMatchObject({
      code: SecurityErrorCode.DECRYPTION_FAILED,
    });
  });

  it('requires the current passphrase, so an unlocked device cannot be reseated', async () => {
    const original = await wrapDataKey(DEK, PASSPHRASE, crypto, context);
    await expect(
      changeDataKeyPassphrase(original, 'wrong1horse-battery', NEXT_PASSPHRASE, crypto, context),
    ).rejects.toMatchObject({ code: SecurityErrorCode.DECRYPTION_FAILED });
  });

  it('refuses to move to a weak passphrase, leaving the old wrapper intact', async () => {
    const original = await wrapDataKey(DEK, PASSPHRASE, crypto, context);
    await expect(
      changeDataKeyPassphrase(original, PASSPHRASE, 'x', crypto, context),
    ).rejects.toMatchObject({ code: SecurityErrorCode.PASSPHRASE_TOO_WEAK });

    // Nothing was consumed: the original still opens under the original.
    const stillOpen = await unwrapDataKey(original, PASSPHRASE, crypto, context);
    expect(Buffer.from(stillOpen)).toEqual(Buffer.from(DEK));
  });

  it('shares nothing with the wrapper it replaced', async () => {
    const original = await wrapDataKey(DEK, PASSPHRASE, crypto, context);
    const rewrapped = await changeDataKeyPassphrase(
      original,
      PASSPHRASE,
      NEXT_PASSPHRASE,
      crypto,
      context,
    );
    expect(rewrapped.wrappedKey.salt).not.toBe(original.wrappedKey.salt);
    expect(rewrapped.wrappedKey.iv).not.toBe(original.wrappedKey.iv);
  });
});

describe('what a wrapper is worth to somebody holding it', () => {
  it('two users wrapping the same key produce unrelated documents', async () => {
    const mine = await wrapDataKey(DEK, PASSPHRASE, crypto, context);
    const theirs = await wrapDataKey(DEK, PASSPHRASE, crypto, {
      ...context,
      userId: 'user-2',
    });
    expect(mine.wrappedKey.ciphertext).not.toBe(theirs.wrappedKey.ciphertext);
    // And neither opens under the other's identity.
    await expect(unwrapDataKey(mine, PASSPHRASE, crypto, { ...context, userId: 'user-2' })).rejects.toThrow();
  });

  it('a wrapper of one key never yields another', async () => {
    const wrapper = await wrapDataKey(DEK, PASSPHRASE, crypto, context);
    const opened = await unwrapDataKey(wrapper, PASSPHRASE, crypto, context);
    expect(Buffer.from(opened)).not.toEqual(Buffer.from(OTHER_DEK));
  });

  it('entropy for a wrapper comes from the crypto service, not the caller', () => {
    // `wrapDataKey` takes no randomness argument: salt and iv come from the
    // injected CryptoService, so there is no seam for a caller to fix them.
    expect(wrapDataKey.length).toBe(4);
    void randomBytes;
  });
});
