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

// Still out of scope, and still worth failing on.
const OUT_OF_SCOPE = ['AppCheck', 'ECDH'];

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
