#!/usr/bin/env node
/**
 * Structural rules from CLAUDE.md that ESLint cannot express.
 * Run by `pnpm check:architecture` and by every package's lint task.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const SKIP = new Set(['node_modules', 'dist', '.git', '.turbo', '.expo', 'coverage']);
const failures = [];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

const files = walk(ROOT);
const sources = files.filter((f) => ['.ts', '.tsx'].includes(extname(f)));

// Rule 4 — no CSS files anywhere.
for (const file of files) {
  if (['.css', '.scss', '.sass', '.less'].includes(extname(file))) {
    failures.push(`CSS file is not allowed: ${relative(ROOT, file)} (styling comes from packages/theme)`);
  }
}

// Rule 4 — no banned styling or state-management libraries in any manifest.
const BANNED_DEPS = ['tailwindcss', 'styled-components', 'emotion', '@emotion/react', 'redux', 'mobx'];
for (const file of files.filter((f) => f.endsWith('package.json'))) {
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
  for (const banned of BANNED_DEPS) {
    if (deps[banned]) {
      failures.push(`${relative(ROOT, file)} depends on "${banned}" — not part of the agreed stack.`);
    }
  }
}

// Rule 2 — Firebase is imported only inside packages/firebase.
const FIREBASE_IMPORT = /from\s+['"](firebase(\/[^'"]*)?|@firebase\/[^'"]*)['"]/;
for (const file of sources) {
  const rel = relative(ROOT, file);
  if (rel.startsWith('packages/firebase/')) continue;
  const text = readFileSync(file, 'utf8');
  if (FIREBASE_IMPORT.test(text)) {
    failures.push(`${rel} imports Firebase directly. Depend on a service interface instead.`);
  }
}

// packages/firebase imports interfaces and types only — never a value, component or hook.
for (const file of sources.filter((f) => relative(ROOT, f).startsWith('packages/firebase/'))) {
  const rel = relative(ROOT, file);
  const text = readFileSync(file, 'utf8');
  const platformImports = text.matchAll(/^\s*import\s+(type\s+)?([^;]*?)\s*from\s+['"](@platform\/[^'"]+)['"]/gm);
  for (const [, typeKeyword, clause, spec] of platformImports) {
    const inlineTypeOnly = clause
      .replace(/^\{|\}$/g, '')
      .split(',')
      .filter((s) => s.trim().length > 0)
      .every((s) => s.trim().startsWith('type '));
    if (!typeKeyword && !inlineTypeOnly) {
      failures.push(`${rel} value-imports ${spec}. packages/firebase may import interfaces and types only.`);
    }
  }
}

// Nothing in packages/ may import from apps/.
for (const file of sources.filter((f) => relative(ROOT, f).startsWith('packages/'))) {
  const text = readFileSync(file, 'utf8');
  if (/from\s+['"][^'"]*apps\//.test(text)) {
    failures.push(`${relative(ROOT, file)} imports from apps/. Shared code must not depend on an application.`);
  }
}

// The React Native crypto path must not depend on a browser global.
//
// `PortableCryptoService` exists because Hermes provides none of these — not
// `crypto.subtle`, not `crypto.getRandomValues`, not `btoa`/`atob`, and not
// `TextEncoder`/`TextDecoder` (verified against the installed `react-native`
// and `@react-native/js-polyfills`, neither of which defines any). Reaching for
// one would not fail here or in CI; it would fail on a user's phone, at the
// moment they try to restore a backup.
//
// The set of files checked is computed by following imports out from each
// entry point, not hard-coded, so pulling in a module that uses a global is
// caught even though that module was never listed.
//
// Recovery-code generation is an entry point in its own right because it is
// not reachable from the crypto service and was for a while the one part of
// this package that still read `crypto.getRandomValues` from the global.
const PORTABLE_ENTRIES = [
  'packages/security/src/services/PortableCryptoService.ts',
  'packages/security/src/recoveryCodes.ts',
  // X-2: record payloads are sealed on the same React Native devices, so the
  // record cipher is on the portable path too.
  'packages/security/src/services/PortableRecordCipher.ts',
  'packages/security/src/recordCrypto.ts',
  // Gate 4: pairing runs on the same React Native devices.
  'packages/security/src/pairing.ts',
  'packages/security/src/services/KeyAgreement.ts',
  'packages/security/src/crypto/verificationCode.ts',
  // Gate 4 integration: the orchestration runs there too, and reaches the
  // lifecycle and the escrow through it.
  'packages/security/src/pairingSession.ts',
].map((path) => join(ROOT, path));
const BROWSER_GLOBALS = [
  { pattern: /\bcrypto\s*\.\s*subtle\b/, name: 'crypto.subtle' },
  { pattern: /\bcrypto\s*\.\s*getRandomValues\b/, name: 'crypto.getRandomValues' },
  { pattern: /\bbtoa\s*\(/, name: 'btoa' },
  { pattern: /\batob\s*\(/, name: 'atob' },
  { pattern: /\bnew\s+TextEncoder\b/, name: 'TextEncoder' },
  { pattern: /\bnew\s+TextDecoder\b/, name: 'TextDecoder' },
];

/** Strips comments, so the prose explaining why a global is banned is not itself a hit. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function portableSurface(entry, seen = new Set()) {
  if (seen.has(entry) || !existsSync(entry)) return seen;
  seen.add(entry);
  // Comments are stripped first so a specifier quoted in prose is not followed,
  // and every `from '...'` is matched regardless of how the clause is wrapped —
  // an earlier version anchored on the line start and silently skipped every
  // multi-line import, which is most of them.
  const text = stripComments(readFileSync(entry, 'utf8'));
  for (const [, spec] of text.matchAll(/from\s*['"](\.[^'"]*)['"]/g)) {
    const base = join(entry, '..', spec.replace(/\.js$/, ''));
    for (const candidate of [`${base}.ts`, join(base, 'index.ts')]) {
      if (existsSync(candidate)) {
        portableSurface(candidate, seen);
        break;
      }
    }
  }
  return seen;
}

const portableFiles = new Set();
for (const entry of PORTABLE_ENTRIES) {
  if (!existsSync(entry)) {
    failures.push(`${relative(ROOT, entry)} is missing — the React Native crypto guard cannot run.`);
    continue;
  }
  portableSurface(entry, portableFiles);
}
for (const file of portableFiles) {
  const code = stripComments(readFileSync(file, 'utf8'));
  for (const { pattern, name } of BROWSER_GLOBALS) {
    if (pattern.test(code)) {
      failures.push(
        `${relative(ROOT, file)} uses ${name}, which React Native does not provide. ` +
          'It is on the React Native crypto path — inject the capability instead.',
      );
    }
  }
}

// ---- Gate 3 scope and secret-handling guard ----------------------------
//
// Two things this cannot let through. First, X-2 record encryption arriving by
// accident: Gate 3 escrows a key that already exists and does not touch domain
// records, so the symbols that would implement record encryption must not
// appear at all. Second, a secret reaching plaintext storage or a log.
//
// Comments are stripped before scanning, because the correct places to name
// `AsyncStorage` and `localStorage` are the comments explaining why they are
// not used — and those must stay readable rather than being contorted to dodge
// a grep.
// X-2 is implemented, so the symbols this guard used to ban are now the
// feature. What replaces them is the rule that makes the feature correct.
//
// The record path must never derive a key. The DEK arrives as 256 uniformly
// random bits; stretching it buys nothing, and at the shipped 210,000 rounds it
// would add roughly 25 seconds per record on the Android hardware the X-1 gate
// measures. That is a property of the import graph, so it is checkable: walk
// out from the record crypto entry points and fail on any KDF.
const RECORD_PATH_ENTRIES = [
  'packages/security/src/recordCrypto.ts',
  'packages/security/src/services/PortableRecordCipher.ts',
  'packages/security/src/services/WebRecordCipher.ts',
  // The pairing transport key is HKDF over a Diffie-Hellman secret. Stretching
  // a high-entropy secret buys nothing and would cost ~25s per pairing on the
  // hardware the X-1 gate measures.
  'packages/security/src/pairing.ts',
  'packages/security/src/services/KeyAgreement.ts',
].map((path) => join(ROOT, path));

const KDF_ON_RECORD_PATH = [
  { pattern: /\bpbkdf2\b/i, name: 'PBKDF2' },
  { pattern: /\bderiveKey\b/, name: 'deriveKey' },
  { pattern: /\bDEFAULT_KDF_ITERATIONS\b|\bMIN_KDF_ITERATIONS\b/, name: 'a KDF iteration count' },
];

// Modules the *passphrase* path also reaches — shared leaves such as the
// envelope constants and the KDF policy itself. They name PBKDF2 legitimately,
// on behalf of the other path, so scanning them would flag every record file
// that imports an AES constant. What is left after removing them is the code
// that exists only to encrypt records, which is where a KDF call would be a
// real defect.
const PASSPHRASE_ENTRIES = [
  'packages/security/src/services/PortableCryptoService.ts',
  'packages/security/src/services/WebCryptoService.ts',
].map((path) => join(ROOT, path));

const passphraseFiles = new Set();
for (const entry of PASSPHRASE_ENTRIES) {
  if (existsSync(entry)) portableSurface(entry, passphraseFiles);
}

const recordPathFiles = new Set();
for (const entry of RECORD_PATH_ENTRIES) {
  if (!existsSync(entry)) {
    failures.push(`${relative(ROOT, entry)} is missing — the record-path KDF guard cannot run.`);
    continue;
  }
  portableSurface(entry, recordPathFiles);
}
for (const shared of passphraseFiles) recordPathFiles.delete(shared);

for (const file of recordPathFiles) {
  const code = stripComments(readFileSync(file, 'utf8'));
  for (const { pattern, name } of KDF_ON_RECORD_PATH) {
    if (pattern.test(code)) {
      failures.push(
        `${relative(ROOT, file)} uses ${name} on the record encryption path. ` +
          'The data encryption key is already random and must be used directly.',
      );
    }
  }
}

// Still out of scope, and still worth failing on. ECDH left the list when Gate 4
// implemented it; App Check has no implementation and no approval.
const OUT_OF_SCOPE = ['AppCheck'];

// ---- Gate 4 architectural rules ----------------------------------------
//
// Two properties the pairing design rests on, both of which are structural and
// so can be checked rather than merely intended.

// Cryptography must not migrate into the relay. packages/firebase moves
// documents; every decision about whether a pairing is safe belongs on the two
// devices. A key agreement or a cipher construction appearing here would mean
// the relay had started participating in the protocol it is meant to carry.
const CRYPTO_IN_RELAY = [
  { pattern: /\bgetSharedSecret\b|\bderiveTransportKey\b|\bp256\b/, name: 'a key agreement' },
  { pattern: /\bgcm\s*\(|subtle\s*\.\s*(?:encrypt|decrypt|deriveBits|deriveKey)\b/, name: 'a cipher' },
  { pattern: /\bverificationCode\b|\bcommitToPublicKey\b/, name: 'the verification code' },
];
for (const file of sources.filter((f) => relative(ROOT, f).startsWith('packages/firebase/src/'))) {
  const code = stripComments(readFileSync(file, 'utf8'));
  for (const { pattern, name } of CRYPTO_IN_RELAY) {
    if (pattern.test(code)) {
      failures.push(
        `${relative(ROOT, file)} performs ${name}. packages/firebase relays pairing ` +
          'material; the protocol runs in packages/security, on both devices.',
      );
    }
  }
}

// No client-authoritative verdict, anywhere. A pairing is authorised by a
// person comparing a code and by the wrapped key opening under the agreed
// transport secret — never by a field asserting that it happened. On Spark
// nothing could adjudicate such a field, so writing one is the banned pattern.
const VERDICT_FIELD =
  /\b(?:verified|isVerified|approved|isApproved|pairingStatus)\s*:\s*(?:true|'verified'|"verified")/;
for (const file of sources) {
  const path = relative(ROOT, file);
  if (!path.startsWith('packages/') && !path.startsWith('apps/')) continue;
  if (path.includes('/tests/') || path.endsWith('.test.ts') || path.endsWith('.test.tsx')) continue;
  const code = stripComments(readFileSync(file, 'utf8'));
  if (VERDICT_FIELD.test(code)) {
    failures.push(
      `${path} writes a verification verdict. A verdict a client can write is a ` +
        'verdict an attacker can write; pairing is authorised by the key agreement.',
    );
  }
}

// Nothing on the pairing integration path may create a data encryption key.
//
// This is the invariant a pairing integration is most likely to break, and it
// breaks quietly: a failed adoption is exactly the moment at which "just set
// one up then" looks like recovery rather than like silently orphaning every
// record encrypted under the key the user already had. There is no legitimate
// reason for any of these files to name a generator, so naming one fails.
const PAIRING_INTEGRATION = [
  'packages/security/src/pairingSession.ts',
  'packages/security/src/services/InMemoryPairingRelay.ts',
  'packages/core/src/PairingFlow.tsx',
  'packages/core/src/pairingStep.ts',
  'packages/core/src/PairDeviceContext.tsx',
].map((path) => join(ROOT, path));

const KEY_CREATION = [
  { pattern: /\bdrawRandomBytes\b/, name: 'a key generator' },
  { pattern: /\.\s*initialize\s*\(/, name: 'first-time key setup' },
  { pattern: /\bgenerateRecoveryCode\b|\bcreateRecoveryEscrow\b/, name: 'recovery-code setup' },
  { pattern: /\.\s*recover\s*\(/, name: 'the recovery path' },
];
for (const file of PAIRING_INTEGRATION) {
  if (!existsSync(file)) {
    failures.push(`${relative(ROOT, file)} is missing — the pairing key-creation guard cannot run.`);
    continue;
  }
  const code = stripComments(readFileSync(file, 'utf8'));
  for (const { pattern, name } of KEY_CREATION) {
    if (pattern.test(code)) {
      failures.push(
        `${relative(ROOT, file)} reaches ${name} on the pairing path. Pairing transfers ` +
          'the key that already exists; a failure must leave both devices unchanged.',
      );
    }
  }
}

// No cryptography inside a React component.
//
// The pairing screens subscribe to a session and render what a pure decision
// function tells them to. A key agreement, a derivation or an envelope opened
// in a component would put key material into render state, where a re-render,
// a devtools inspection or an error boundary can reach it.
const CRYPTO_IN_COMPONENTS = [
  { pattern: /\bderiveTransportKey\b|\bgetSharedSecret\b|\bP256KeyAgreement\b/, name: 'a key agreement' },
  { pattern: /\bhkdf\s*\(|\bpbkdf2\b|\bgcm\s*\(|subtle\s*\.\s*\w+/, name: 'a primitive' },
  {
    pattern:
      /\bwrapDataKeyForPairing\b|\bcompletePairing\b|\bderivePairingAgreement\b|\bacceptPairing\b|\bcreatePairingOffer\b/,
    name: 'a protocol step',
  },
  { pattern: /\bcommitToPublicKey\b|\bverificationCode\b|\bcommitmentMatches\b/, name: 'the verification code' },
];
for (const file of sources.filter((f) => {
  const path = relative(ROOT, f);
  return path.startsWith('packages/core/src/') && path.endsWith('.tsx');
})) {
  const code = stripComments(readFileSync(file, 'utf8'));
  for (const { pattern, name } of CRYPTO_IN_COMPONENTS) {
    if (pattern.test(code)) {
      failures.push(
        `${relative(ROOT, file)} performs ${name} in a component. The protocol runs in ` +
          '@platform/security; components render what a decision function returns.',
      );
    }
  }
}

// ---- Gate 5: the encryption boundary cannot be wired around ------------
//
// Three properties that used to be conventions and are now structural. Each is
// checked at the exact place a regression would land, because each of them
// fails the same way if it is lost: an application writes a user's records in
// the clear and finds out only when Firestore refuses the document — and only
// then if it is talking to Firestore at all.

// 1. AppCore's encryption wiring is mandatory.
//
// `recordCipher` and `dataKeyLifecycleFor` were optional, so a composition root
// could supply a repository and omit the cipher; AppCore then rendered the
// application straight over the raw one. Nothing warned, because the two shapes
// are indistinguishable at that point. Making the pair required removes the
// combination from the type system, and this stops it coming back.
const APP_CORE = join(ROOT, 'packages/core/src/AppCore.tsx');
if (!existsSync(APP_CORE)) {
  failures.push('packages/core/src/AppCore.tsx is missing — the encryption-wiring guard cannot run.');
} else {
  const code = stripComments(readFileSync(APP_CORE, 'utf8'));
  for (const field of ['recordCipher', 'dataKeyLifecycleFor']) {
    if (new RegExp(`\\b${field}\\s*\\?\\s*:`).test(code)) {
      failures.push(
        `packages/core/src/AppCore.tsx makes ${field} optional. Encryption wiring is ` +
          'mandatory: a composition that omits it renders the application over the raw repository.',
      );
    }
  }
  // The provider must not be reachable past a conditional that skips it.
  if (!/<EncryptedRepositoryProvider/.test(code)) {
    failures.push(
      'packages/core/src/AppCore.tsx no longer renders EncryptedRepositoryProvider. ' +
        'Every signed-in path must pass through the encryption boundary.',
    );
  }
}

// 2. The accessor domain code uses must refuse the raw repository.
//
// `EncryptedRepositoryProvider` legitimately reads the unwrapped one — it is
// the caller whose job is to wrap it — so the check belongs on `useRepository`,
// which is what every screen calls.
const SERVICES_PROVIDER = join(ROOT, 'packages/core/src/ServicesProvider.tsx');
if (!existsSync(SERVICES_PROVIDER)) {
  failures.push('packages/core/src/ServicesProvider.tsx is missing — the accessor guard cannot run.');
} else {
  const code = stripComments(readFileSync(SERVICES_PROVIDER, 'utf8'));
  if (!/useRepository[\s\S]*?repositoryForConsumer\s*\(/.test(code)) {
    failures.push(
      'packages/core/src/ServicesProvider.tsx returns a repository from useRepository() ' +
        'without repositoryForConsumer(). A screen must never receive the unencrypting store.',
    );
  }
}

// 3. The backup flows require the boundary, in the types and at runtime.
const BACKUP_FLOW = join(ROOT, 'packages/backup/src/services/backupFlow.ts');
if (!existsSync(BACKUP_FLOW)) {
  failures.push('packages/backup/src/services/backupFlow.ts is missing — the backup guard cannot run.');
} else {
  const code = stripComments(readFileSync(BACKUP_FLOW, 'utf8'));
  if (/repository\s*:\s*Repository\b/.test(code)) {
    failures.push(
      'packages/backup/src/services/backupFlow.ts accepts a bare Repository. runRestore ' +
        'writes domain records; given the raw store those fields reach persistence in the clear.',
    );
  }
  const asserts = code.match(/assertEncryptedRepository\s*\(/g) ?? [];
  if (asserts.length < 2) {
    failures.push(
      'packages/backup/src/services/backupFlow.ts does not assert the encryption boundary ' +
        'in both runBackup and runRestore. The type alone does not survive a cast.',
    );
  }
}

// 4. No application screen or data module reaches persistence directly.
//
// The path is screen -> useRepository() -> EncryptingRepository -> whatever is
// underneath. A screen that imports @platform/firebase, or constructs a
// repository of its own, has left that path.
for (const file of sources) {
  const path = relative(ROOT, file);
  if (!/^apps\/[^/]+\/src\/(screens|data|domain)\//.test(path)) continue;
  const code = stripComments(readFileSync(file, 'utf8'));
  if (/from\s*['"]@platform\/firebase['"]/.test(code)) {
    failures.push(
      `${path} imports @platform/firebase. Screens and data modules reach persistence ` +
        'through useRepository(); only the composition root names a backend.',
    );
  }
  if (/new\s+(?:Firebase|InMemory|Encrypting)Repository\b/.test(code)) {
    failures.push(
      `${path} constructs a repository. The one it may use is injected and already ` +
        'encrypts; constructing another one bypasses the boundary.',
    );
  }
}

const RULES_FILE = join(ROOT, 'firestore.rules');
if (existsSync(RULES_FILE)) {
  const rules = readFileSync(RULES_FILE, 'utf8').replace(/\/\/[^\n]*/g, '');
  if (/\bdata\s*\.\s*(?:verified|isVerified|approved|pairingStatus)\b/.test(rules)) {
    failures.push(
      'firestore.rules reads a client-written verification verdict. ' +
        'Authorization must come from the request and from immutable session fields.',
    );
  }
}

// Plaintext key-value stores. Deliberately not a bare `localStorage` match:
// IndexedDB is permitted and is reached through `indexedDB`, and the browser
// custody tier stores ciphertext there under a non-extractable key.
const PLAINTEXT_STORES = [
  { pattern: /\bAsyncStorage\b/, name: 'AsyncStorage' },
  { pattern: /\b(?:window\.|globalThis\.)?localStorage\s*[.[]/, name: 'localStorage' },
  { pattern: /\b(?:window\.|globalThis\.)?sessionStorage\s*[.[]/, name: 'sessionStorage' },
];

// A log line that names key material or a decrypted payload.
const SECRET_LOG = /console\.(?:log|info|warn|error|debug)\s*\([^)]*\b(?:recoveryCode|recovery_code|dataKey|dek|wrappingKey|passphrase|plaintextKey|plaintext|decrypted)\b/i;

const SECRET_BEARING = sources.filter((f) => {
  const path = relative(ROOT, f);
  return (
    (path.startsWith('packages/security/') ||
      path.startsWith('packages/firebase/') ||
      path.startsWith('packages/data/') ||
      path.startsWith('apps/') ||
      path.startsWith('tools/')) &&
    !path.includes('/tests/') &&
    !path.endsWith('.test.ts') &&
    !path.endsWith('.test.tsx')
  );
});

for (const file of SECRET_BEARING) {
  const code = stripComments(readFileSync(file, 'utf8'));
  const where = relative(ROOT, file);

  for (const symbol of OUT_OF_SCOPE) {
    if (new RegExp(`\\b${symbol}\\b`).test(code)) {
      failures.push(`${where} references ${symbol}, which is not in scope.`);
    }
  }

  for (const { pattern, name } of PLAINTEXT_STORES) {
    if (pattern.test(code)) {
      failures.push(
        `${where} writes to ${name}, which holds plaintext. ` +
          'Keys and recovery material go through the Gate 2 custody abstraction.',
      );
    }
  }

  if (SECRET_LOG.test(code)) {
    failures.push(`${where} logs key material. A secret must never reach a log.`);
  }
}

// Every shared package has a public API and a README.
for (const pkg of readdirSync(join(ROOT, 'packages'))) {
  for (const required of ['src/index.ts', 'README.md', 'package.json']) {
    if (!existsSync(join(ROOT, 'packages', pkg, required))) {
      failures.push(`packages/${pkg} is missing ${required}`);
    }
  }
}

if (failures.length > 0) {
  console.error('Architecture check failed:\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(`\n${failures.length} violation(s). See CLAUDE.md.`);
  process.exit(1);
}
console.log('Architecture check passed.');
