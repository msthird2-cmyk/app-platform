import type { RandomBytes } from '../crypto/entropy';
import { PortableRecordCipher } from './PortableRecordCipher';
import { WebRecordCipher } from './WebRecordCipher';
import type { RecordCipher } from '../types/recordCipher';

export interface CreateRecordCipherOptions {
  randomBytes: RandomBytes;
  /** Forces an implementation. Tests use it; applications should not. */
  prefer?: 'web' | 'portable';
}

/**
 * Picks the record cipher the runtime can actually provide.
 *
 * Capability detection rather than `Platform.OS`, exactly as
 * `createCryptoService` does: what matters is whether `crypto.subtle` is
 * reachable, not which operating system is underneath. React Native provides
 * no WebCrypto, so it lands on the portable implementation — and the X-1 gate
 * runs that on a real Hermes engine with the browser globals deleted.
 */
export function createRecordCipher(options: CreateRecordCipherOptions): RecordCipher {
  const { randomBytes, prefer } = options;
  if (prefer === 'portable') return new PortableRecordCipher(randomBytes);
  if (prefer === 'web') return new WebRecordCipher(randomBytes);

  const subtle = (globalThis as { crypto?: { subtle?: unknown } }).crypto?.subtle;
  return typeof subtle === 'object' && subtle !== null
    ? new WebRecordCipher(randomBytes)
    : new PortableRecordCipher(randomBytes);
}
