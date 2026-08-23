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
