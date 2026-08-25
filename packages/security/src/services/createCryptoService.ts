import { PortableCryptoService, type RandomBytes } from './PortableCryptoService';
import { WebCryptoService } from './WebCryptoService';
import type { CryptoService } from '../types/crypto';

export interface CreateCryptoServiceOptions {
  /**
   * The platform's entropy source, supplied by the composition root.
   *
   * On React Native this is `expo-crypto`'s `getRandomBytes`; on web the
   * application can pass the same thing, which delegates to
   * `crypto.getRandomValues`. It is required even when WebCrypto turns out to
   * be available, so that a device without WebCrypto is a supported
   * configuration rather than a crash at first use.
   */
  randomBytes: RandomBytes;
  iterations?: number;
}

/**
 * Picks the strongest `CryptoService` the runtime can support.
 *
 * WebCrypto wins wherever it exists, because it can hold a derived key as a
 * non-extractable `CryptoKey` that JavaScript never sees the bytes of. React
 * Native has no WebCrypto, so there it falls through to the portable
 * implementation, which produces a byte-identical envelope — a backup taken on
 * one is readable on the other.
 *
 * This is capability detection rather than a `Platform.select`, because the
 * thing that actually matters is whether `crypto.subtle` is present, not which
 * operating system is underneath: `react-native-web` on an old browser and
 * Hermes on a phone need the same answer for the same reason.
 */
export function createCryptoService(options: CreateCryptoServiceOptions): CryptoService {
  const subtle = (globalThis as { crypto?: { subtle?: unknown } }).crypto?.subtle;
  if (typeof subtle === 'object' && subtle !== null) {
    return new WebCryptoService(options.iterations);
  }
  return new PortableCryptoService(options);
}
