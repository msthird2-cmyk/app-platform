import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';

/**
 * The one module in the platform that knows Firebase exists. Configuration is
 * supplied by the application — never hard-coded here.
 */
export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export function createFirebaseApp(config: FirebaseConfig, name = '[DEFAULT]'): FirebaseApp {
  const existing = getApps().find((app) => app.name === name);
  if (existing) return getApp(name);
  return name === '[DEFAULT]' ? initializeApp(config) : initializeApp(config, name);
}
