import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * `react-native` is aliased to a stub. Its published entry point is Flow-typed
 * source that Vite cannot parse, and it reaches this package's import graph
 * transitively — the shared barrels export screens alongside services, so
 * importing `createProductionServices` drags it in even though no test here
 * renders anything.
 *
 * The alias covers rendering only. Every security-relevant module — the record
 * cipher, the encrypting repository, the recovery escrow, the pairing relay and
 * the Firebase services — is the real one.
 */
export default defineConfig({
  resolve: {
    alias: {
      'react-native': fileURLToPath(new URL('./tests/stubs/react-native.ts', import.meta.url)),
    },
  },
});
