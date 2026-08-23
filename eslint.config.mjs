import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * The dependency table in CLAUDE.md is authoritative; this is its
 * machine-readable form. Every package's allowed imports are listed here and
 * the per-package ESLint overrides below are generated from them, so the table
 * and the enforcement cannot drift apart.
 *
 * `firebase` is deliberately absent: it may import interfaces and types from
 * any package, and the type-only part of that rule is checked by
 * scripts/check-architecture.mjs, which ESLint cannot express.
 */
const DEPENDENCIES = {
  utils: [],
  theme: ['utils'],
  security: ['utils'],
  ui: ['theme', 'utils'],
  data: ['utils', 'security'],
  auth: ['ui', 'theme', 'utils', 'security'],
  account: ['ui', 'theme', 'utils', 'data'],
  backup: ['ui', 'theme', 'utils', 'data', 'security'],
  core: ['utils', 'theme', 'security', 'ui', 'data', 'auth', 'account', 'backup'],
};

const ALL_PACKAGES = [...Object.keys(DEPENDENCIES), 'firebase'];

const FIREBASE_PATTERN = {
  group: ['firebase', 'firebase/*', '@firebase/*'],
  message:
    'Firebase may only be imported inside packages/firebase. Depend on a service interface instead.',
};

const DEEP_IMPORT_PATTERN = {
  group: ALL_PACKAGES.map((name) => `@platform/${name}/*`),
  message: 'Import from the package root (@platform/x), never a deep path into its internals.',
};

const STYLING_PATTERN = {
  group: ['tailwindcss', 'styled-components', '@emotion/*', '*.css', '*.scss'],
  message: 'Styling comes from packages/theme. No CSS, Tailwind or styled-components.',
};

const APPS_PATTERN = {
  group: ['**/apps/*', '@app/*'],
  message: 'Shared code must never depend on an application.',
};

function restrictedImports(patterns) {
  return ['error', { patterns }];
}

/** Everything a package may not import, derived from the table above. */
function forbiddenPackages(name) {
  const allowed = new Set(DEPENDENCIES[name]);
  return ALL_PACKAGES.filter((candidate) => candidate !== name && !allowed.has(candidate)).map(
    (candidate) => `@platform/${candidate}`,
  );
}

const DOM_ELEMENTS = [
  'div', 'span', 'button', 'input', 'select', 'p', 'a', 'form', 'label',
  'img', 'ul', 'li', 'table', 'h1', 'h2', 'h3', 'textarea', 'section',
];

const packageOverrides = Object.keys(DEPENDENCIES).map((name) => {
  const forbidden = forbiddenPackages(name);
  return {
    files: [`packages/${name}/src/**/*`],
    rules: {
      'no-restricted-imports': restrictedImports([
        FIREBASE_PATTERN,
        DEEP_IMPORT_PATTERN,
        STYLING_PATTERN,
        APPS_PATTERN,
        ...(forbidden.length > 0
          ? [
              {
                group: forbidden,
                message: `packages/${name} may only import: ${
                  DEPENDENCIES[name].map((d) => `@platform/${d}`).join(', ') || 'nothing internal'
                } (see the dependency table in CLAUDE.md).`,
              },
            ]
          : []),
      ]),
    },
  };
});

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**', '**/.expo/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: `JSXOpeningElement[name.name=/^(${DOM_ELEMENTS.join('|')})$/]`,
          message:
            'Web DOM elements are not allowed. Use React Native primitives (View, Text, Pressable, …).',
        },
      ],
      'no-restricted-imports': restrictedImports([
        FIREBASE_PATTERN,
        DEEP_IMPORT_PATTERN,
        STYLING_PATTERN,
      ]),
    },
  },
  ...packageOverrides,
  {
    // The one place Firebase itself may be imported. Type-only imports of other
    // packages are checked by scripts/check-architecture.mjs.
    files: ['packages/firebase/**/*'],
    rules: {
      'no-restricted-imports': restrictedImports([DEEP_IMPORT_PATTERN, STYLING_PATTERN, APPS_PATTERN]),
    },
  },
  {
    // Applications may import any shared package, but never each other.
    files: ['apps/*/**/*'],
    rules: {
      'no-restricted-imports': restrictedImports([
        FIREBASE_PATTERN,
        DEEP_IMPORT_PATTERN,
        STYLING_PATTERN,
      ]),
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/tests/**/*'],
    rules: { 'no-restricted-imports': restrictedImports([STYLING_PATTERN]) },
  },
  {
    files: ['scripts/**/*.mjs', '*.mjs', '**/*.config.*'],
    rules: { 'no-restricted-imports': 'off' },
  },
);
