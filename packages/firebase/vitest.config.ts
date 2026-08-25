import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Security-rule tests need the Firebase emulators; they run through the
    // root `test:rules` script, not the ordinary package test task.
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.rules.test.ts'],
  },
});
