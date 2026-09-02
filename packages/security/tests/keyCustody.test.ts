import { webcrypto } from 'node:crypto';
import { custodyAddressFor } from '../src/custodyAddress';
import { describe, expect, it } from 'vitest';
import { createKeyCustody, type CustodyStorage } from '../src/keyCustody';
import { InMemorySecureStorage } from '../src/services/InMemorySecureStorage';
import { OsKeystoreStorage, type SecureStoreBackend } from '../src/services/OsKeystoreStorage';
import { createPlatformSecureStorage } from '../src/services/createSecureStorage';
import {
  WebNonExtractableStorage,
  type KeyValueDatabase,
  type SubtleLike,
} from '../src/services/WebNonExtractableStorage';
import { SecurityErrorCode } from '../src/errors';
import { meetsProtection, type ProtectionTier } from '../src/protectionTier';
import { toBase64 } from '../src/crypto/base64';


const TEST_OWNER = 'custody-owner';
const randomBytes = (length: number): Uint8Array =>
  webcrypto.getRandomValues(new Uint8Array(length));

/** Deterministic, obviously fake, and never zero. */
const TEST_DEK = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 13) % 256);
const STORAGE_KEY = custodyAddressFor(TEST_OWNER);

/** A store at whatever tier a case needs, with hooks for making reads fail. */
class Fake implements CustodyStorage {
  readonly entries = new Map<string, string>();
  failNextGet: Error | null = null;

  constructor(readonly protection: ProtectionTier) {}

  async get(key: string): Promise<string | null> {
    if (this.failNextGet) {
      const error = this.failNextGet;
      this.failNextGet = null;
      throw error;
    }
    return this.entries.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.entries.set(key, value);
  }
  async remove(key: string): Promise<void> {
    this.entries.delete(key);
  }
}

describe('protection tiers', () => {
  it('orders the tiers and refuses anything below the requirement', () => {
    expect(meetsProtection('os-keystore', 'os-keystore')).toBe(true);
    expect(meetsProtection('os-keystore', 'browser-nonextractable')).toBe(true);
    expect(meetsProtection('browser-nonextractable', 'browser-nonextractable')).toBe(true);
    expect(meetsProtection('browser-nonextractable', 'os-keystore')).toBe(false);
    expect(meetsProtection('memory', 'browser-nonextractable')).toBe(false);
    expect(meetsProtection('memory', 'os-keystore')).toBe(false);
  });

  it('reports memory for the in-memory store', () => {
    expect(new InMemorySecureStorage().protection).toBe('memory');
  });
});

describe('minimum-tier enforcement', () => {
  it('refuses to construct custody over process memory', () => {
    expect(() => createKeyCustody(new Fake('memory'), { owner: TEST_OWNER })).toThrowError(
      expect.objectContaining({ code: SecurityErrorCode.SECURE_STORAGE_UNAVAILABLE }),
    );
    // Even when the caller lowers the bar as far as the type system permits.
    expect(() =>
      createKeyCustody(new Fake('memory'), { owner: TEST_OWNER, minimumProtection: 'browser-nonextractable' }),
    ).toThrowError(expect.objectContaining({ code: SecurityErrorCode.SECURE_STORAGE_UNAVAILABLE }));
  });

  it('refuses the browser tier unless the caller opts into it explicitly', () => {
    expect(() => createKeyCustody(new Fake('browser-nonextractable'), { owner: TEST_OWNER })).toThrowError(
      expect.objectContaining({ code: SecurityErrorCode.SECURE_STORAGE_UNAVAILABLE }),
    );
    expect(() =>
      createKeyCustody(new Fake('browser-nonextractable'), {
        owner: TEST_OWNER,
        minimumProtection: 'browser-nonextractable',
      }),
    ).not.toThrow();
  });

  it('accepts the keystore tier by default', () => {
    expect(() => createKeyCustody(new Fake('os-keystore'), { owner: TEST_OWNER })).not.toThrow();
  });
});

describe('custody lifecycle', () => {
  it('reports absent before anything is stored, and load returns null', async () => {
    const custody = createKeyCustody(new Fake('os-keystore'), { owner: TEST_OWNER });
    await expect(custody.status()).resolves.toBe('absent');
    await expect(custody.load()).resolves.toBeNull();
  });

  it('stores and loads the exact bytes', async () => {
    const custody = createKeyCustody(new Fake('os-keystore'), { owner: TEST_OWNER });
    await custody.store(TEST_DEK);
    await expect(custody.status()).resolves.toBe('present');
    const loaded = await custody.load();
    expect(loaded).not.toBeNull();
    expect(Array.from(loaded as Uint8Array)).toEqual(Array.from(TEST_DEK));
  });

  it('clears back to absent', async () => {
    const custody = createKeyCustody(new Fake('os-keystore'), { owner: TEST_OWNER });
    await custody.store(TEST_DEK);
    await custody.clear();
    await expect(custody.status()).resolves.toBe('absent');
    await expect(custody.load()).resolves.toBeNull();
  });

  it('replaces rather than appends', async () => {
    const storage = new Fake('os-keystore');
    const custody = createKeyCustody(storage, { owner: TEST_OWNER });
    await custody.store(TEST_DEK);
    const other = Uint8Array.from({ length: 32 }, (_, i) => (i * 11 + 3) % 256);
    await custody.store(other);
    expect(Array.from((await custody.load()) as Uint8Array)).toEqual(Array.from(other));
    expect(storage.entries.size).toBe(1);
  });

  it('refuses anything that is not a 32-byte key', async () => {
    const custody = createKeyCustody(new Fake('os-keystore'), { owner: TEST_OWNER });
    for (const bad of [new Uint8Array(16), new Uint8Array(64), new Uint8Array(0)]) {
      await expect(custody.store(bad)).rejects.toMatchObject({
        code: SecurityErrorCode.KEY_CUSTODY_INVALID,
      });
    }
    await expect(custody.store('not bytes' as never)).rejects.toMatchObject({
      code: SecurityErrorCode.KEY_CUSTODY_INVALID,
    });
  });

  it('refuses an all-zero key, which is a stub rather than a key', async () => {
    const custody = createKeyCustody(new Fake('os-keystore'), { owner: TEST_OWNER });
    await expect(custody.store(new Uint8Array(32))).rejects.toMatchObject({
      code: SecurityErrorCode.KEY_CUSTODY_INVALID,
    });
  });
});

/**
 * The heart of Gate 2. Every case here exists to stop one specific mistake:
 * concluding "there is no key" when there is one that cannot be read, and then
 * generating a replacement that orphans every encrypted record.
 */
describe('unreadable is never absent', () => {
  it('reports unusable when the stored value is corrupt', async () => {
    const storage = new Fake('os-keystore');
    const custody = createKeyCustody(storage, { owner: TEST_OWNER });
    for (const corrupt of [
      'not json at all',
      JSON.stringify({ v: 1 }),
      JSON.stringify({ v: 2, k: toBase64(TEST_DEK) }),
      JSON.stringify({ v: 1, k: 'not valid base64!' }),
      JSON.stringify({ v: 1, k: toBase64(new Uint8Array(16)) }),
    ]) {
      storage.entries.set(STORAGE_KEY, corrupt);
      await expect(custody.status(), corrupt).resolves.toBe('unusable');
      await expect(custody.load(), corrupt).rejects.toMatchObject({
        code: SecurityErrorCode.KEY_CUSTODY_UNUSABLE,
      });
    }
  });

  it('reports unusable — never absent — when the read throws', async () => {
    const storage = new Fake('os-keystore');
    const custody = createKeyCustody(storage, { owner: TEST_OWNER });
    await custody.store(TEST_DEK);

    storage.failNextGet = new Error('keystore key invalidated');
    await expect(custody.status()).resolves.toBe('unusable');

    storage.failNextGet = new Error('keystore key invalidated');
    await expect(custody.load()).rejects.toMatchObject({
      code: SecurityErrorCode.KEY_CUSTODY_UNUSABLE,
    });
  });

  it('fails closed on a transient read failure and recovers afterwards', async () => {
    const storage = new Fake('os-keystore');
    const custody = createKeyCustody(storage, { owner: TEST_OWNER });
    await custody.store(TEST_DEK);

    storage.failNextGet = new Error('transient');
    await expect(custody.load()).rejects.toMatchObject({
      code: SecurityErrorCode.KEY_CUSTODY_UNUSABLE,
    });

    // The key was never touched, so the next read succeeds.
    expect(Array.from((await custody.load()) as Uint8Array)).toEqual(Array.from(TEST_DEK));
  });

  it('never invents a replacement key', async () => {
    const storage = new Fake('os-keystore');
    const custody = createKeyCustody(storage, { owner: TEST_OWNER });
    storage.entries.set(STORAGE_KEY, 'corrupt');

    await expect(custody.load()).rejects.toThrow();
    // The corrupt entry is still exactly what it was: custody did not
    // overwrite it, and did not quietly put a new key in its place.
    expect(storage.entries.get(STORAGE_KEY)).toBe('corrupt');
    expect(storage.entries.size).toBe(1);
  });
});

/**
 * Custody's half of the passphrase work.
 *
 * `dataKeyProtection.test.ts` exercises the lifecycle, which short-circuits on
 * `status()` and never reaches `load()` for a protected key. These cases go at
 * custody directly, so the guarantee holds for any future caller that does not
 * check the status first — which is exactly the caller that would get hurt.
 */
describe('a protected key is present and shut', () => {
  /** A v2 envelope. Custody never opens one, so the contents are irrelevant. */
  const WRAPPED = JSON.stringify({
    v: 2,
    w: { version: 1, wrappedKey: { version: 1, algorithm: 'AES-GCM', iterations: 210_000 } },
  });

  it('reports protected — never absent, and never present', async () => {
    const storage = new Fake('os-keystore');
    const custody = createKeyCustody(storage, { owner: TEST_OWNER });
    storage.entries.set(STORAGE_KEY, WRAPPED);

    const status = await custody.status();
    expect(status).toBe('protected');
    // Both of the wrong answers, named. `absent` is the state in which a
    // caller creates a key; `present` is the state in which it expects
    // `load()` to hand one over.
    expect(status).not.toBe('absent');
    expect(status).not.toBe('present');
  });

  it('throws rather than returning null from load()', async () => {
    const storage = new Fake('os-keystore');
    const custody = createKeyCustody(storage, { owner: TEST_OWNER });
    storage.entries.set(STORAGE_KEY, WRAPPED);

    // `null` is the contract's word for "there is no key". Returning it here
    // would tell first-time setup to run, and setup writes a new key over this
    // one — orphaning every record encrypted under the original.
    await expect(custody.load()).rejects.toMatchObject({
      code: SecurityErrorCode.DATA_KEY_LOCKED,
    });
  });

  it('hands back the wrapper for opening, and nothing else does', async () => {
    const storage = new Fake('os-keystore');
    const custody = createKeyCustody(storage, { owner: TEST_OWNER });
    storage.entries.set(STORAGE_KEY, WRAPPED);

    expect(await custody.loadWrapped()).toEqual(JSON.parse(WRAPPED).w);
  });

  it('reports no wrapper for an unprotected or empty device', async () => {
    const storage = new Fake('os-keystore');
    const custody = createKeyCustody(storage, { owner: TEST_OWNER });

    expect(await custody.loadWrapped()).toBeNull();
    await custody.store(TEST_DEK);
    // `null`, not the key: a caller asking for a wrapper must not be handed
    // the plaintext key because there happens to be one.
    expect(await custody.loadWrapped()).toBeNull();
  });

  it('storing a wrapper replaces the plain key in the same slot', async () => {
    const storage = new Fake('os-keystore');
    const custody = createKeyCustody(storage, { owner: TEST_OWNER });
    await custody.store(TEST_DEK);

    await custody.storeWrapped(JSON.parse(WRAPPED).w);

    expect([...storage.entries.keys()]).toEqual([STORAGE_KEY]);
    expect(await custody.status()).toBe('protected');
    // And the plaintext key is gone from storage, not merely shadowed.
    expect(storage.entries.get(STORAGE_KEY)).not.toContain(toBase64(TEST_DEK));
  });

  it('storing a plain key over a wrapper unprotects it, which recovery relies on', async () => {
    const storage = new Fake('os-keystore');
    const custody = createKeyCustody(storage, { owner: TEST_OWNER });
    storage.entries.set(STORAGE_KEY, WRAPPED);

    // Deliberate. Recovery and pairing both call `store`, both are moments at
    // which a key arrives on a device, and neither holds a passphrase.
    await custody.store(TEST_DEK);
    expect(await custody.status()).toBe('present');
    expect(Array.from((await custody.load()) as Uint8Array)).toEqual(Array.from(TEST_DEK));
  });

  it('refuses a wrapper that is not even an object', async () => {
    const storage = new Fake('os-keystore');
    const custody = createKeyCustody(storage, { owner: TEST_OWNER });
    for (const bad of [null, undefined, 'wrapper', 42]) {
      await expect(custody.storeWrapped(bad)).rejects.toMatchObject({
        code: SecurityErrorCode.KEY_CUSTODY_INVALID,
      });
    }
    expect(storage.entries.size).toBe(0);
  });

  it('a malformed v2 envelope is unusable, not absent and not protected', async () => {
    const storage = new Fake('os-keystore');
    const custody = createKeyCustody(storage, { owner: TEST_OWNER });
    for (const bad of [
      JSON.stringify({ v: 2 }),
      JSON.stringify({ v: 2, w: null }),
      JSON.stringify({ v: 2, w: 'wrapper' }),
      JSON.stringify({ v: 3, w: {} }),
    ]) {
      storage.entries.set(STORAGE_KEY, bad);
      await expect(custody.status(), bad).resolves.toBe('unusable');
      await expect(custody.load(), bad).rejects.toThrow();
    }
  });
});

describe('OsKeystoreStorage', () => {
  /**
   * The platform this mock is standing in for.
   *
   * It matters, and this suite originally did not model it: `AFTER_FIRST_UNLOCK`
   * is read off the native module, and only the iOS module defines it. A mock
   * that omitted the constant while every test passed `keychainAccessible: 1`
   * was describing a device that does not exist — an Android backend configured
   * the iOS way — so the whole suite went green while both emulators failed to
   * construct secure storage at all. `ios` now carries the constant and
   * `android` does not, which is the only difference the real modules have.
   */
  type Platform = 'ios' | 'android';

  function backend(
    platform: Platform = 'android',
    overrides: Partial<SecureStoreBackend> = {},
  ) {
    const entries = new Map<string, string>();
    const calls: Array<{ op: string; options?: unknown }> = [];
    const base: SecureStoreBackend = {
      async isAvailableAsync() {
        return true;
      },
      async getItemAsync(key, options) {
        calls.push({ op: 'get', options });
        return entries.get(key) ?? null;
      },
      async setItemAsync(key, value, options) {
        calls.push({ op: 'set', options });
        entries.set(key, value);
      },
      async deleteItemAsync(key, options) {
        calls.push({ op: 'delete', options });
        entries.delete(key);
      },
    };
    const platformConstants =
      platform === 'ios' ? { AFTER_FIRST_UNLOCK: 1 } : {};
    return {
      store: { ...base, ...platformConstants, ...overrides },
      entries,
      calls,
    };
  }

  it('reports the keystore tier and round-trips a key', async () => {
    const { store, entries } = backend('android');
    const storage = await OsKeystoreStorage.create(store, {});
    expect(storage.protection).toBe('os-keystore');

    const custody = createKeyCustody(storage, { owner: TEST_OWNER });
    await custody.store(TEST_DEK);
    expect(Array.from((await custody.load()) as Uint8Array)).toEqual(Array.from(TEST_DEK));

    // On native the keystore *is* the protection, so the envelope reaching
    // SecureStore does contain the key — that is the design, not a leak. What
    // matters is that it reached the keystore and nothing else: this class has
    // exactly one sink, the injected backend, and no other storage to fall
    // back to. The web tier, which has no keystore, seals values first; see
    // the WebNonExtractableStorage suite for that assertion.
    expect(entries.size).toBe(1);
    const stored = [...entries.values()][0] as string;
    expect(stored).toContain('"v":1');
    expect(JSON.parse(stored)).toMatchObject({ v: 1, k: toBase64(TEST_DEK) });
  });

  it('fails closed when SecureStore is unavailable', async () => {
    const { store } = backend('android', { isAvailableAsync: async () => false });
    await expect(OsKeystoreStorage.create(store, {})).rejects.toMatchObject({
      code: SecurityErrorCode.SECURE_STORAGE_UNAVAILABLE,
    });
  });

  it('fails closed when the availability check itself throws', async () => {
    const { store } = backend('android', {
      isAvailableAsync: async () => {
        throw new Error('no native module');
      },
    });
    await expect(OsKeystoreStorage.create(store, {})).rejects.toMatchObject({
      code: SecurityErrorCode.SECURE_STORAGE_UNAVAILABLE,
    });
  });

  it('passes the accessibility through and never requires authentication', async () => {
    const { store, calls } = backend('ios');
    const storage = await OsKeystoreStorage.create(store, {
      keychainAccessible: 42,
      keychainService: 'net-worth',
    });
    await storage.set('k', 'v');
    await storage.get('k');
    for (const call of calls) {
      expect(call.options).toMatchObject({
        keychainAccessible: 42,
        keychainService: 'net-worth',
        requireAuthentication: false,
      });
    }
  });

  it('lets a read failure propagate instead of reporting absence', async () => {
    const { store } = backend('android', {
      getItemAsync: async () => {
        throw new Error('keystore key invalidated');
      },
    });
    const storage = await OsKeystoreStorage.create(store, {});
    await expect(storage.get('k')).rejects.toThrow();
    await expect(createKeyCustody(storage, { owner: TEST_OWNER }).status()).resolves.toBe('unusable');
  });

  // The four cases below are the regression for a defect the emulator gate
  // caught and this suite did not: requiring a numeric keychainAccessible on
  // every platform made Android unable to construct secure storage at all.
  // Both API 29 and API 34 threw SECURE_STORAGE_UNAVAILABLE immediately after
  // reporting expo-secure-store as available.

  it('constructs on Android, which has no accessibility constant', async () => {
    const { store } = backend('android');
    const storage = await OsKeystoreStorage.create(store, {});
    expect(storage.protection).toBe('os-keystore');
  });

  it('omits keychainAccessible entirely on Android', async () => {
    const { store, calls } = backend('android');
    const storage = await OsKeystoreStorage.create(store, {});
    await storage.set('k', 'v');
    await storage.get('k');
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.options).not.toHaveProperty('keychainAccessible');
      expect(call.options).toMatchObject({ requireAuthentication: false });
    }
  });

  it('refuses an accessibility value on a platform that would drop it', async () => {
    const { store } = backend('android');
    await expect(
      OsKeystoreStorage.create(store, { keychainAccessible: 1 }),
    ).rejects.toMatchObject({ code: SecurityErrorCode.SECURE_STORAGE_MISCONFIGURED });
  });

  it('still refuses to take the iOS WHEN_UNLOCKED default', async () => {
    // The original guard was right about this platform, and it stays closed:
    // omitting the choice on iOS silently yields a store that works in the
    // foreground and fails every background read.
    const { store } = backend('ios');
    await expect(OsKeystoreStorage.create(store, {})).rejects.toMatchObject({
      code: SecurityErrorCode.SECURE_STORAGE_MISCONFIGURED,
    });
  });

  it('clears only what it wrote', async () => {
    const { store, entries } = backend('android');
    entries.set('someone.elses.key', 'not ours');
    const storage = await OsKeystoreStorage.create(store, {});
    await storage.set('ours', 'value');
    await storage.clear();
    expect(entries.has('ours')).toBe(false);
    expect(entries.get('someone.elses.key')).toBe('not ours');
  });
});

describe('WebNonExtractableStorage', () => {
  function database(): KeyValueDatabase & { entries: Map<string, unknown> } {
    const entries = new Map<string, unknown>();
    return {
      entries,
      async read(key) {
        return entries.get(key);
      },
      async write(key, value) {
        entries.set(key, value);
      },
      async delete(key) {
        entries.delete(key);
      },
      async keys() {
        return [...entries.keys()];
      },
    };
  }

  const subtle = webcrypto.subtle as unknown as SubtleLike;

  it('reports the browser tier and never the keystore tier', async () => {
    const storage = await WebNonExtractableStorage.create({
      subtle,
      database: database(),
      randomBytes,
    });
    expect(storage.protection).toBe('browser-nonextractable');
    expect(storage.protection).not.toBe('os-keystore');
  });

  it('persists a non-extractable wrapping key, not key bytes', async () => {
    const db = database();
    await WebNonExtractableStorage.create({ subtle, database: db, randomBytes });
    const stored = db.entries.get('__platform.kek') as CryptoKey;
    expect(stored.extractable).toBe(false);
    expect(stored.type).toBe('secret');
    // The bytes cannot be got back out, by us or by anyone else.
    await expect(webcrypto.subtle.exportKey('raw', stored)).rejects.toThrow();
  });

  it('round-trips a key through custody', async () => {
    const storage = await WebNonExtractableStorage.create({
      subtle,
      database: database(),
      randomBytes,
    });
    const custody = createKeyCustody(storage, { owner: TEST_OWNER, minimumProtection: 'browser-nonextractable' });
    await expect(custody.status()).resolves.toBe('absent');
    await custody.store(TEST_DEK);
    await expect(custody.status()).resolves.toBe('present');
    expect(Array.from((await custody.load()) as Uint8Array)).toEqual(Array.from(TEST_DEK));
    await custody.clear();
    await expect(custody.status()).resolves.toBe('absent');
  });

  it('writes no raw key bytes into the database', async () => {
    const db = database();
    const storage = await WebNonExtractableStorage.create({ subtle, database: db, randomBytes });
    await createKeyCustody(storage, { owner: TEST_OWNER, minimumProtection: 'browser-nonextractable' }).store(TEST_DEK);

    const serialisable = [...db.entries.entries()].filter(([name]) => name !== '__platform.kek');
    const dump = JSON.stringify(serialisable);
    expect(dump).not.toContain(toBase64(TEST_DEK));
    // Not even a distinctive run of the key's own base64.
    expect(dump).not.toContain(toBase64(TEST_DEK).slice(0, 16));
    for (const byte of [...TEST_DEK.slice(0, 8)]) {
      expect(dump).not.toContain(`,${byte},`);
    }
    expect(dump).toContain('"v":1');
  });

  it('reports unusable when the wrapping key can no longer open a blob', async () => {
    const db = database();
    const storage = await WebNonExtractableStorage.create({ subtle, database: db, randomBytes });
    await createKeyCustody(storage, { owner: TEST_OWNER, minimumProtection: 'browser-nonextractable' }).store(TEST_DEK);

    // A cleared origin regenerates the wrapping key; the old blob survives.
    db.entries.delete('__platform.kek');
    const reopened = await WebNonExtractableStorage.create({ subtle, database: db, randomBytes });
    const custody = createKeyCustody(reopened, { owner: TEST_OWNER, minimumProtection: 'browser-nonextractable' });
    await expect(custody.status()).resolves.toBe('unusable');
    await expect(custody.load()).rejects.toMatchObject({
      code: SecurityErrorCode.KEY_CUSTODY_UNUSABLE,
    });
  });

  it('fails closed when the database is unreachable', async () => {
    const broken: KeyValueDatabase = {
      async read() {
        throw new Error('IndexedDB blocked');
      },
      async write() {},
      async delete() {},
      async keys() {
        return [];
      },
    };
    await expect(
      WebNonExtractableStorage.create({ subtle, database: broken, randomBytes }),
    ).rejects.toMatchObject({ code: SecurityErrorCode.SECURE_STORAGE_UNAVAILABLE });
  });
});


/**
 * The selector had no tests at all, which is how it shipped rejecting Android.
 *
 * Every unit test constructed OsKeystoreStorage directly, so nothing exercised
 * the one function the applications and the runtime harness actually call —
 * and its guard, `typeof keychainAccessible !== 'number'`, cannot be satisfied
 * on a platform whose module defines no accessibility constants. Both emulators
 * threw here immediately after reporting expo-secure-store as available.
 */
describe('createPlatformSecureStorage', () => {
  function nativeBackend(platform: 'ios' | 'android'): SecureStoreBackend {
    const entries = new Map<string, string>();
    const base: SecureStoreBackend = {
      async isAvailableAsync() {
        return true;
      },
      async getItemAsync(key) {
        return entries.get(key) ?? null;
      },
      async setItemAsync(key, value) {
        entries.set(key, value);
      },
      async deleteItemAsync(key) {
        entries.delete(key);
      },
    };
    return platform === 'ios' ? { ...base, AFTER_FIRST_UNLOCK: 1 } : base;
  }

  it('builds Android storage from the call the applications actually make', async () => {
    // Exactly what apps/*/index.tsx and the X-1 harness pass: the constant is
    // read unconditionally, and on Android it evaluates to undefined.
    const secureStore = nativeBackend('android');
    const storage = await createPlatformSecureStorage({
      secureStore,
      keychainAccessible: (secureStore as { AFTER_FIRST_UNLOCK?: number }).AFTER_FIRST_UNLOCK,
    });
    expect(storage.protection).toBe('os-keystore');

    // And it is a working store, not merely a constructed one.
    const custody = createKeyCustody(storage, { owner: TEST_OWNER });
    expect(await custody.status()).toBe('absent');
    await custody.store(TEST_DEK);
    expect(Array.from((await custody.load()) as Uint8Array)).toEqual(Array.from(TEST_DEK));
  });

  it('builds iOS storage from the same call', async () => {
    const secureStore = nativeBackend('ios');
    const storage = await createPlatformSecureStorage({
      secureStore,
      keychainAccessible: (secureStore as { AFTER_FIRST_UNLOCK?: number }).AFTER_FIRST_UNLOCK,
    });
    expect(storage.protection).toBe('os-keystore');
  });

  it('refuses iOS without an explicit accessibility choice', async () => {
    await expect(
      createPlatformSecureStorage({ secureStore: nativeBackend('ios') }),
    ).rejects.toMatchObject({ code: SecurityErrorCode.SECURE_STORAGE_MISCONFIGURED });
  });

  it('fails closed when the runtime offers no secure tier at all', async () => {
    await expect(createPlatformSecureStorage({})).rejects.toMatchObject({
      code: SecurityErrorCode.SECURE_STORAGE_UNAVAILABLE,
    });
  });

  it('never falls back to process memory', async () => {
    // The absence of a fallback is the invariant; assert it as one.
    await expect(createPlatformSecureStorage({})).rejects.toThrow();
    await expect(
      createPlatformSecureStorage({ subtle: undefined, database: undefined }),
    ).rejects.toThrow();
  });
});
