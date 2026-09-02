import { describe, expect, it } from 'vitest';
import { CUSTODY_ADDRESS_PREFIX, custodyAddressFor } from '../src/custodyAddress';
import { SecurityErrorCode } from '../src/errors';

/**
 * The address is the whole isolation mechanism, so its properties are the
 * security properties: one identity always resolves to one address, two
 * identities never resolve to the same one, and every address the function can
 * produce is storable.
 */
describe('custodyAddressFor', () => {
  it('is deterministic — the same identity always resolves to the same address', () => {
    // Load-bearing for reinstall and restart: an address that drifted would
    // orphan a key whose owner can still reach it.
    expect(custodyAddressFor('alice-uid')).toBe(custodyAddressFor('alice-uid'));
  });

  it('gives distinct identities distinct addresses', () => {
    const seen = new Set(
      ['alice-uid', 'bob-uid', 'carol-uid', 'alice-uid2', 'Alice-uid'].map(custodyAddressFor),
    );
    expect(seen.size).toBe(5);
  });

  it('does not treat identities as case-insensitive or trim them', () => {
    // No normalisation: the identity is an opaque token from the auth provider
    // and this function must not decide two of them are the same.
    expect(custodyAddressFor('alice')).not.toBe(custodyAddressFor('Alice'));
    expect(custodyAddressFor('alice')).not.toBe(custodyAddressFor(' alice'));
  });

  it('emits only characters the storage layer accepts', () => {
    // The constraint is expo-secure-store's, quoted from its own build:
    // "Keys must not be empty and contain only alphanumeric characters,
    // '.', '-', and '_'."
    for (const identity of ['alice-uid', '', 'ünïcødé', 'has spaces', 'sym+bo/ls=']) {
      const address = identity === '' ? null : custodyAddressFor(identity);
      if (address === null) continue;
      expect(address, identity).toMatch(/^[A-Za-z0-9._-]+$/);
    }
  });

  it('survives an identity the charset would otherwise reject', () => {
    // This is why the identity is hashed rather than interpolated: a provider
    // that ever issues one of these must not produce an unstorable address.
    expect(custodyAddressFor('sym+bo/ls=')).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(custodyAddressFor('ünïcødé')).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('carries the scheme version in a stable prefix', () => {
    // Versioned in the address, so a future re-namespacing is a new prefix
    // rather than a change to how an existing address is read.
    expect(CUSTODY_ADDRESS_PREFIX).toBe('platform.dek.v2.');
    expect(custodyAddressFor('alice-uid')).toMatch(/^platform\.dek\.v2\.[0-9a-f]{64}$/);
  });

  it('is never the legacy global slot, for any identity', () => {
    // The legacy address is not read, written or migrated by this change; the
    // one thing that must hold is that no identity can collide with it.
    for (const identity of ['alice-uid', 'platform.dek.v1', '']) {
      if (identity === '') continue;
      expect(custodyAddressFor(identity)).not.toBe('platform.dek.v1');
    }
  });

  it('refuses an empty identity rather than inventing an address for it', () => {
    // An empty identity is not a user. Hashing it would produce a perfectly
    // valid shared address — exactly the defect this change removes — so it
    // fails closed instead.
    expect(() => custodyAddressFor('')).toThrowError(
      expect.objectContaining({ code: SecurityErrorCode.KEY_CUSTODY_INVALID }),
    );
  });
});
