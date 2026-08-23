import { webcrypto } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { PortableCryptoService } from '../src/services/PortableCryptoService';
import { WebCryptoService } from '../src/services/WebCryptoService';
import { createCryptoService } from '../src/services/createCryptoService';
import { SecurityErrorCode } from '../src/errors';
import { MIN_KDF_ITERATIONS } from '../src/kdfPolicy';
import { describeCryptoContract, CONTEXT } from './cryptoContract';

/**
 * The entropy source is injected rather than taken from a global, so the tests
 * supply one too. In an application this is the platform's own generator —
 * `expo-crypto`'s `getRandomBytes` on React Native.
 */
const randomBytes = (length: number): Uint8Array =>
  webcrypto.getRandomValues(new Uint8Array(length));

describeCryptoContract(
  'PortableCryptoService',
  () => new PortableCryptoService({ randomBytes, iterations: MIN_KDF_ITERATIONS }),
);

describe('PortableCryptoService — injected entropy', () => {
  it('refuses to construct without a generator', () => {
    // @ts-expect-error deliberately omitting the required option
    expect(() => new PortableCryptoService({})).toThrowError(
      expect.objectContaining({ code: SecurityErrorCode.ENCRYPTION_PARAMETERS_INVALID }),
    );
    expect(
      // @ts-expect-error deliberately passing the wrong type
      () => new PortableCryptoService({ randomBytes: 'nope' }),
    ).toThrowError(expect.objectContaining({ code: SecurityErrorCode.ENCRYPTION_PARAMETERS_INVALID }));
  });

  // A stub generator is the realistic wiring mistake, and it is the one that
  // destroys every salt and nonce without failing anywhere visible.
  it('rejects a generator that returns all zeroes', async () => {
    const crypto = new PortableCryptoService({
      randomBytes: (length) => new Uint8Array(length),
      iterations: MIN_KDF_ITERATIONS,
    });
    await expect(crypto.encrypt('secret', 'passphrase', CONTEXT)).rejects.toMatchObject({
      code: SecurityErrorCode.ENCRYPTION_PARAMETERS_INVALID,
    });
    await expect(crypto.hashSecret('secret')).rejects.toMatchObject({
      code: SecurityErrorCode.ENCRYPTION_PARAMETERS_INVALID,
    });
  });

  it('rejects a generator that returns the wrong length or the wrong type', async () => {
    const short = new PortableCryptoService({
      randomBytes: () => Uint8Array.of(1, 2, 3),
      iterations: MIN_KDF_ITERATIONS,
    });
    await expect(short.encrypt('secret', 'passphrase', CONTEXT)).rejects.toMatchObject({
      code: SecurityErrorCode.ENCRYPTION_PARAMETERS_INVALID,
    });

    const wrongType = new PortableCryptoService({
      randomBytes: ((length: number) => new Array(length).fill(1)) as never,
      iterations: MIN_KDF_ITERATIONS,
    });
    await expect(wrongType.encrypt('secret', 'passphrase', CONTEXT)).rejects.toMatchObject({
      code: SecurityErrorCode.ENCRYPTION_PARAMETERS_INVALID,
    });
  });

  it('asks for a 16-byte salt and a 12-byte nonce', async () => {
    const lengths: number[] = [];
    const crypto = new PortableCryptoService({
      randomBytes: (length) => {
        lengths.push(length);
        return randomBytes(length);
      },
      iterations: MIN_KDF_ITERATIONS,
    });
    await crypto.encrypt('secret', 'passphrase', CONTEXT);
    expect(lengths).toEqual([16, 12]);
  });
});

describe('PortableCryptoService — runtime independence', () => {
  // The point of this implementation is that it runs where these do not exist.
  // Deleting them from the global object is the only honest way to assert that
  // from Node, which has all of them.
  it('encrypts and decrypts with crypto, btoa, atob, TextEncoder and TextDecoder removed', async () => {
    const globals = globalThis as unknown as Record<string, unknown>;
    const saved = {
      crypto: globals.crypto,
      btoa: globals.btoa,
      atob: globals.atob,
      TextEncoder: globals.TextEncoder,
      TextDecoder: globals.TextDecoder,
    };
    // The generator was captured before the globals were removed, exactly as a
    // composition root would have captured the platform's own.
    const crypto = new PortableCryptoService({ randomBytes, iterations: MIN_KDF_ITERATIONS });
    try {
      for (const key of Object.keys(saved)) delete globals[key];
      const payload = await crypto.encrypt('net worth: 1234', 'passphrase', CONTEXT);
      await expect(crypto.decrypt(payload, 'passphrase', CONTEXT)).resolves.toBe('net worth: 1234');
      const stored = await crypto.hashSecret('the-secret');
      await expect(crypto.verifySecret('the-secret', stored)).resolves.toBe(true);
      expect(await crypto.hash('value')).toHaveLength(44);
    } finally {
      Object.assign(globals, saved);
    }
  });
});

describe('@platform/security module graph', () => {
  /**
   * The Android bundle contains `WebCryptoService` too, because
   * `createCryptoService` references both. That is harmless only if no module
   * on the package's import graph touches a browser global while it is being
   * *evaluated* — a top-level `const x = crypto.subtle` would crash the app at
   * startup on Hermes, before any of the careful runtime checks could run.
   *
   * The bundler cannot tell us that. Importing the package with the globals
   * removed can.
   */
  it('evaluates with no browser globals present', async () => {
    const globals = globalThis as unknown as Record<string, unknown>;
    const saved = {
      crypto: globals.crypto,
      btoa: globals.btoa,
      atob: globals.atob,
      TextEncoder: globals.TextEncoder,
      TextDecoder: globals.TextDecoder,
    };
    vi.resetModules();
    try {
      for (const key of Object.keys(saved)) delete globals[key];
      const security = await import('../src/index');
      expect(typeof security.createCryptoService).toBe('function');
      expect(typeof security.PortableCryptoService).toBe('function');
      expect(typeof security.WebCryptoService).toBe('function');
    } finally {
      Object.assign(globals, saved);
      vi.resetModules();
    }
  });

  // With no WebCrypto, the factory must not hand back the WebCrypto service.
  it('selects the portable implementation when crypto.subtle is absent', async () => {
    const globals = globalThis as unknown as Record<string, unknown>;
    const saved = globals.crypto;
    try {
      delete globals.crypto;
      const service = createCryptoService({ randomBytes, iterations: MIN_KDF_ITERATIONS });
      expect(service).toBeInstanceOf(PortableCryptoService);
      const payload = await service.encrypt('selected', 'passphrase', CONTEXT);
      await expect(service.decrypt(payload, 'passphrase', CONTEXT)).resolves.toBe('selected');
    } finally {
      globals.crypto = saved;
    }
  });

  it('selects the WebCrypto implementation when crypto.subtle is present', () => {
    const service = createCryptoService({ randomBytes, iterations: MIN_KDF_ITERATIONS });
    expect(service).toBeInstanceOf(WebCryptoService);
  });
});
