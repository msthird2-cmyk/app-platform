import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  ReCaptchaV3Provider,
} from 'firebase/app-check';

/**
 * The one module in the platform that knows Firebase exists. Configuration is
 * supplied by the application — never hard-coded here.
 *
 * None of these values is a secret: the API key ships in every client bundle
 * by design. That is precisely why App Check is mandatory below — without
 * attestation, anyone holding this configuration can call the backend directly
 * and every client-side control becomes advisory.
 */
export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export type AppCheckOptions =
  | {
      provider: 'recaptcha-enterprise' | 'recaptcha-v3';
      siteKey: string;
      isTokenAutoRefreshEnabled?: boolean;
    }
  | {
      /**
       * Explicit opt-out. Requires a written reason so that shipping without
       * attestation is a recorded decision rather than an omission — for
       * example a React Native build, where App Check is provided by the
       * native SDK instead of this one.
       */
      provider: 'disabled';
      reason: string;
    };

export interface CreateFirebaseAppOptions {
  appCheck: AppCheckOptions;
  name?: string;
}

/**
 * `appCheck` is required rather than optional: an application cannot reach the
 * backend without stating how it attests, or stating why it does not.
 */
export function createFirebaseApp(
  config: FirebaseConfig,
  options: CreateFirebaseAppOptions,
): FirebaseApp {
  const name = options.name ?? '[DEFAULT]';
  const existing = getApps().find((app) => app.name === name);
  if (existing) return getApp(name);

  const app = name === '[DEFAULT]' ? initializeApp(config) : initializeApp(config, name);

  if (options.appCheck.provider !== 'disabled') {
    initializeAppCheck(app, {
      provider:
        options.appCheck.provider === 'recaptcha-enterprise'
          ? new ReCaptchaEnterpriseProvider(options.appCheck.siteKey)
          : new ReCaptchaV3Provider(options.appCheck.siteKey),
      isTokenAutoRefreshEnabled: options.appCheck.isTokenAutoRefreshEnabled ?? true,
    });
  }

  return app;
}
