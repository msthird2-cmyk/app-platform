import { defineConfig } from 'vitest/config';

/**
 * Firebase Security Rule tests. Run through `pnpm test:rules`, which starts the
 * Firestore and Storage emulators around this suite.
 */
export default defineConfig({
  test: {
    include: ['packages/firebase/tests/**/*.rules.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
