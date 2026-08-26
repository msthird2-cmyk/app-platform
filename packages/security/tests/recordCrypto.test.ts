import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fromBase64, toBase64 } from '../src/crypto/base64';
import { SecurityErrorCode } from '../src/errors';
import {
  decryptRecordPayload,
  encryptRecordPayload,
} from '../src/recordCrypto';
import {
  RECORD_ENVELOPE_VERSION,
  RECORD_PURPOSE,
  recordAdditionalData,
  type RecordContext,
} from '../src/recordEnvelope';
import { PortableRecordCipher } from '../src/services/PortableRecordCipher';
import { WebRecordCipher } from '../src/services/WebRecordCipher';
import { createRecordCipher } from '../src/services/createRecordCipher';
import { utf8Decode } from '../src/crypto/utf8';
import type { RecordCipher } from '../src/types/recordCipher';

/**
 * Entropy is injected, never taken from a global, so a test can be
 * deterministic without stubbing `crypto` out from under the implementation.
 */
const realRandom = (length: number): Uint8Array =>
  webcrypto.getRandomValues(new Uint8Array(length));

/** A counter-based source: obviously fake, and repeatable. */
function fixedRandom(seed: number) {
  let n = seed;
  return (length: number): Uint8Array =>
    Uint8Array.from({ length }, () => (n = (n * 31 + 17) % 251) + 1);
}

const DEK = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 13) % 256);
const OTHER_DEK = Uint8Array.from({ length: 32 }, (_, i) => (i * 11 + 5) % 256);

const CONTEXT: RecordContext = {
  userId: 'alice-uid',
  appName: 'networth',
  collection: 'assets',
  recordId: 'a1',
};

const PAYLOAD = { name: 'Savings', amount: 1234.56, note: 'rainy day — £' };

function tamper(text: string): string {
  return (text[0] === 'A' ? 'B' : 'A') + text.slice(1);
}

/** The same battery against both engines: a record written on one device has
 *  to open on the other. */
function describeRecordCipher(name: string, build: () => RecordCipher) {
  describe(`${name} — record cipher contract`, () => {
    const cipher = build();

    it('round-trips a payload', async () => {
      const envelope = await encryptRecordPayload(PAYLOAD, DEK, CONTEXT, cipher);
      expect(envelope.v).toBe(RECORD_ENVELOPE_VERSION);
      expect(envelope.alg).toBe('AES-GCM');
      expect(await decryptRecordPayload(envelope, DEK, CONTEXT, cipher)).toEqual(PAYLOAD);
    });

    it('round-trips an empty payload and a large one', async () => {
      const big = { blob: 'x'.repeat(50_000), nested: { deep: [1, 2, 3] } };
      for (const payload of [{}, big]) {
        const envelope = await encryptRecordPayload(payload, DEK, CONTEXT, cipher);
        expect(await decryptRecordPayload(envelope, DEK, CONTEXT, cipher)).toEqual(payload);
      }
    });

    it('never repeats a nonce, and never emits the plaintext', async () => {
      const a = await encryptRecordPayload(PAYLOAD, DEK, CONTEXT, cipher);
      const b = await encryptRecordPayload(PAYLOAD, DEK, CONTEXT, cipher);
      expect(a.iv).not.toEqual(b.iv);
      expect(a.ct).not.toEqual(b.ct);
      for (const envelope of [a, b]) {
        const serialised = JSON.stringify(envelope);
        expect(serialised).not.toContain('Savings');
        expect(serialised).not.toContain('1234.56');
        expect(serialised).not.toContain(toBase64(DEK));
      }
    });

    it('encrypts many records independently', async () => {
      const contexts = ['a1', 'a2', 'a3'].map((recordId) => ({ ...CONTEXT, recordId }));
      const envelopes = await Promise.all(
        contexts.map((context, i) =>
          encryptRecordPayload({ index: i }, DEK, context, cipher),
        ),
      );
      for (const [i, context] of contexts.entries()) {
        expect(await decryptRecordPayload(envelopes[i]!, DEK, context, cipher)).toEqual({
          index: i,
        });
      }
    });

    it('rejects the wrong data encryption key', async () => {
      const envelope = await encryptRecordPayload(PAYLOAD, DEK, CONTEXT, cipher);
      await expect(
        decryptRecordPayload(envelope, OTHER_DEK, CONTEXT, cipher),
      ).rejects.toMatchObject({ code: SecurityErrorCode.DECRYPTION_FAILED });
    });

    it('rejects a modified ciphertext or nonce', async () => {
      const envelope = await encryptRecordPayload(PAYLOAD, DEK, CONTEXT, cipher);
      for (const mutated of [
        { ...envelope, ct: tamper(envelope.ct) },
        { ...envelope, iv: tamper(envelope.iv) },
      ]) {
        await expect(
          decryptRecordPayload(mutated, DEK, CONTEXT, cipher),
        ).rejects.toMatchObject({ code: SecurityErrorCode.DECRYPTION_FAILED });
      }
    });

    it('rejects every wrong binding in the additional data', async () => {
      const envelope = await encryptRecordPayload(PAYLOAD, DEK, CONTEXT, cipher);
      const wrong: Array<[string, RecordContext]> = [
        ['user', { ...CONTEXT, userId: 'bob-uid' }],
        ['application', { ...CONTEXT, appName: 'expense' }],
        ['collection', { ...CONTEXT, collection: 'liabilities' }],
        ['record id', { ...CONTEXT, recordId: 'a2' }],
      ];
      for (const [label, context] of wrong) {
        await expect(
          decryptRecordPayload(envelope, DEK, context, cipher),
          label,
        ).rejects.toMatchObject({ code: SecurityErrorCode.DECRYPTION_FAILED });
      }
    });

    it('rejects a key that is not an AES-256 key', async () => {
      for (const bad of [new Uint8Array(16), new Uint8Array(33), new Uint8Array(32)]) {
        await expect(
          encryptRecordPayload(PAYLOAD, bad, CONTEXT, cipher),
          String(bad.length),
        ).rejects.toMatchObject({ code: SecurityErrorCode.DATA_KEY_UNAVAILABLE });
      }
    });

    it('rejects a malformed envelope before touching the key', async () => {
      for (const value of [
        null, undefined, 'a string', 42, [], {},
        { v: 1, alg: 'AES-GCM', iv: 'AA' },
        { v: 1, alg: 'AES-GCM', ct: 'AA' },
        { v: 1, alg: 'AES-GCM', iv: 42, ct: 'AA' },
      ]) {
        await expect(
          decryptRecordPayload(value, DEK, CONTEXT, cipher),
          JSON.stringify(value) ?? String(value),
        ).rejects.toMatchObject({ code: SecurityErrorCode.RECORD_ENVELOPE_INVALID });
      }
    });

    it('rejects an unsupported version or algorithm', async () => {
      const envelope = await encryptRecordPayload(PAYLOAD, DEK, CONTEXT, cipher);
      await expect(
        decryptRecordPayload({ ...envelope, v: 2 }, DEK, CONTEXT, cipher),
      ).rejects.toMatchObject({ code: SecurityErrorCode.ENCRYPTION_VERSION_UNSUPPORTED });
      await expect(
        decryptRecordPayload({ ...envelope, alg: 'AES-CBC' }, DEK, CONTEXT, cipher),
      ).rejects.toMatchObject({ code: SecurityErrorCode.ENCRYPTION_ALGORITHM_UNSUPPORTED });
    });
  });
}

describeRecordCipher('WebRecordCipher', () => new WebRecordCipher(realRandom));
describeRecordCipher('PortableRecordCipher', () => new PortableRecordCipher(realRandom));

describe('the two engines agree byte for byte', () => {
  it('opens each other output in both directions', async () => {
    const web = new WebRecordCipher(realRandom);
    const portable = new PortableRecordCipher(realRandom);

    const fromWeb = await encryptRecordPayload(PAYLOAD, DEK, CONTEXT, web);
    expect(await decryptRecordPayload(fromWeb, DEK, CONTEXT, portable)).toEqual(PAYLOAD);

    const fromPortable = await encryptRecordPayload(PAYLOAD, DEK, CONTEXT, portable);
    expect(await decryptRecordPayload(fromPortable, DEK, CONTEXT, web)).toEqual(PAYLOAD);
  });

  it('produces identical ciphertext for an identical nonce', async () => {
    // Injected entropy rather than a stubbed global, so both implementations
    // draw the same nonce and any divergence is in the cipher, not the source.
    const web = new WebRecordCipher(fixedRandom(7));
    const portable = new PortableRecordCipher(fixedRandom(7));
    const a = await encryptRecordPayload(PAYLOAD, DEK, CONTEXT, web);
    const b = await encryptRecordPayload(PAYLOAD, DEK, CONTEXT, portable);
    expect(a.iv).toBe(b.iv);
    expect(a.ct).toBe(b.ct);
  });
});

describe('record additional data', () => {
  it('names the purpose, so a record envelope is its own domain', () => {
    const aad = utf8Decode(recordAdditionalData(CONTEXT, RECORD_ENVELOPE_VERSION));
    expect(aad).toBe(
      '{"v":1,"alg":"AES-GCM","pur":"record.v1","uid":"alice-uid","app":"networth",'
      + '"col":"assets","rid":"a1"}',
    );
    expect(RECORD_PURPOSE).toBe('record.v1');
  });

  it('changes whenever any bound field changes', () => {
    const base = utf8Decode(recordAdditionalData(CONTEXT, 1));
    for (const context of [
      { ...CONTEXT, userId: 'bob-uid' },
      { ...CONTEXT, appName: 'expense' },
      { ...CONTEXT, collection: 'liabilities' },
      { ...CONTEXT, recordId: 'a2' },
    ]) {
      expect(utf8Decode(recordAdditionalData(context, 1))).not.toBe(base);
    }
  });
});

describe('the record path does not derive a key', () => {
  it('carries no KDF fields at all in the envelope', async () => {
    const cipher = new PortableRecordCipher(realRandom);
    const envelope = await encryptRecordPayload(PAYLOAD, DEK, CONTEXT, cipher);
    expect(Object.keys(envelope).sort()).toEqual(['alg', 'ct', 'iv', 'v']);
    // The passphrase envelope's KDF fields are absent by construction: there is
    // nothing to derive from a key that is already 256 random bits, and at the
    // shipped 210,000 rounds doing so would add ~25s per record on Android.
    expect(envelope).not.toHaveProperty('salt');
    expect(envelope).not.toHaveProperty('iterations');
  });

  it('runs far faster than a single PBKDF2 derivation would', async () => {
    // Not a benchmark — a guard. If somebody routes this through a KDF, a
    // hundred records will not finish in a second.
    const cipher = new PortableRecordCipher(realRandom);
    const started = Date.now();
    for (let i = 0; i < 100; i += 1) {
      const context = { ...CONTEXT, recordId: `a${i}` };
      const envelope = await encryptRecordPayload({ i }, DEK, context, cipher);
      await decryptRecordPayload(envelope, DEK, context, cipher);
    }
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('createRecordCipher', () => {
  it('selects an implementation by capability and honours an override', async () => {
    const selected = createRecordCipher({ randomBytes: realRandom });
    expect(selected).toBeInstanceOf(WebRecordCipher);
    expect(createRecordCipher({ randomBytes: realRandom, prefer: 'portable' }))
      .toBeInstanceOf(PortableRecordCipher);

    const envelope = await encryptRecordPayload(PAYLOAD, DEK, CONTEXT, selected);
    expect(fromBase64(envelope.iv).length).toBe(12);
  });
});
