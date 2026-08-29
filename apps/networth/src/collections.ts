/**
 * The collections this application may store records in.
 *
 * Extracted from `App.tsx` because the production composition needs the same
 * list — `FirebaseRepository` and `FirebaseAccountService` both take it — and
 * two copies that drift is how a restore starts writing somewhere the Security
 * Rules do not expect. The rules carry the authoritative allowlist; this must
 * be a subset of it.
 */
export const COLLECTIONS = ['assets', 'liabilities', 'snapshots'] as const;
