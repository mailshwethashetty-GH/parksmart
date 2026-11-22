import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/migrations/**', 'data/**', 'docs/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  // Layering: packages/shared imports nothing from other workspace packages.
  {
    files: ['packages/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['@parksmart/*'] }],
    },
  },
  // Non-negotiable #3: the engine stays pure and deterministic.
  // No DB, network, clock or Math.random. Only @parksmart/shared may be imported.
  {
    files: ['packages/engine/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@parksmart/*', '!@parksmart/shared'],
              message: 'Engine may only import @parksmart/shared.',
            },
            {
              group: ['node:*', 'fs', 'http', 'https', 'net', 'better-sqlite3', 'drizzle-orm*'],
              message: 'Engine must not do I/O.',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded PRNG.' },
        { object: 'Date', property: 'now', message: 'Pass time in as input.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Pass time in as input.',
        },
        { selector: "CallExpression[callee.name='fetch']", message: 'Engine must not do I/O.' },
      ],
    },
  },
  // One copy of drizzle-orm: apps import query helpers from @parksmart/db.
  {
    files: ['apps/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['drizzle-orm', 'drizzle-orm/*'],
              message: 'Import query helpers from @parksmart/db (single drizzle-orm copy).',
            },
          ],
        },
      ],
    },
  },
  // Layering: route handlers never touch the DB directly (routes → services → db).
  {
    files: ['apps/api/src/routes/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@parksmart/db', 'drizzle-orm*'],
              message: 'Routes call services, not the DB.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
