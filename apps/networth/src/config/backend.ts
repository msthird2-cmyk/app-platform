import type { FirebaseConfig } from '@platform/firebase';

/**
 * Which backend this build talks to, decided from configuration alone.
 *
 * Two rules shape everything here.
 *
 * **Nothing is hard-coded.** Firebase client configuration is public — it ships
 * in every bundle by design — but it is still deployment configuration, and a
 * project id committed to a repository is a project somebody eventually writes
 * to by accident. It comes from the environment or the build does not run
 * against Firebase.
 *
 * **There is no fallback.** A build that asked for Firebase and cannot have it
 * does not quietly become a preview build storing records in a process that is
 * about to exit. It reports a misconfiguration and renders a failure. Falling
 * back would be the same class of mistake as a plaintext fallback: the app
 * appears to work, and the user's data is not where they think it is.
 *
 * Expo inlines `EXPO_PUBLIC_*` at build time through `babel-preset-expo`, so
 * this needs no new dependency and no secret ever reaches the repository.
 */

/** Selects the composition. Absent means preview, which is the safe default. */
export const BACKEND_VARIABLE = 'EXPO_PUBLIC_NETWORTH_BACKEND';

/**
 * Every value `createFirebaseApp` needs, and the variable each comes from.
 * Order is the order they are reported missing in, so the message is stable.
 */
export const FIREBASE_VARIABLES = {
  apiKey: 'EXPO_PUBLIC_FIREBASE_API_KEY',
  authDomain: 'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
  projectId: 'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  storageBucket: 'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'EXPO_PUBLIC_FIREBASE_APP_ID',
} as const satisfies Record<keyof FirebaseConfig, string>;

export type BackendSelection =
  | { kind: 'preview' }
  | { kind: 'firebase'; firebase: FirebaseConfig }
  /** Asked for a backend it cannot construct. Never silently downgraded. */
  | { kind: 'misconfigured'; reason: 'missing-configuration'; missing: readonly string[] }
  | { kind: 'misconfigured'; reason: 'unknown-backend'; value: string };

export type Environment = Readonly<Record<string, string | undefined>>;

/** Blank is missing. An empty string in a CI variable is a forgotten value. */
function present(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Pure, so the decision that governs where a user's records go can be asserted
 * directly rather than inferred from a running application.
 */
export function selectBackend(env: Environment): BackendSelection {
  const requested = env[BACKEND_VARIABLE]?.trim();

  // Unset is the ordinary case for a checkout, a preview build and CI.
  if (requested === undefined || requested.length === 0 || requested === 'preview') {
    return { kind: 'preview' };
  }
  // A typo must not read as "preview". It read as an intention to leave it.
  if (requested !== 'firebase') {
    return { kind: 'misconfigured', reason: 'unknown-backend', value: requested };
  }

  const missing: string[] = [];
  for (const variable of Object.values(FIREBASE_VARIABLES)) {
    if (!present(env[variable])) missing.push(variable);
  }
  if (missing.length > 0) {
    return { kind: 'misconfigured', reason: 'missing-configuration', missing };
  }

  return {
    kind: 'firebase',
    firebase: {
      apiKey: env[FIREBASE_VARIABLES.apiKey] as string,
      authDomain: env[FIREBASE_VARIABLES.authDomain] as string,
      projectId: env[FIREBASE_VARIABLES.projectId] as string,
      storageBucket: env[FIREBASE_VARIABLES.storageBucket] as string,
      messagingSenderId: env[FIREBASE_VARIABLES.messagingSenderId] as string,
      appId: env[FIREBASE_VARIABLES.appId] as string,
    },
  };
}

/** Copy for the failure screen. Names what is wrong; carries no value. */
export function misconfigurationMessage(
  selection: Extract<BackendSelection, { kind: 'misconfigured' }>,
): string {
  if (selection.reason === 'unknown-backend') {
    return `${BACKEND_VARIABLE} is set to an unrecognised value, so this build does not `
      + 'know which backend to use. Set it to "firebase" or "preview".';
  }
  return 'This build is configured to use Firebase but is missing configuration: '
    + `${selection.missing.join(', ')}.`;
}
