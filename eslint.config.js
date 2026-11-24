import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-plugin-prettier/recommended';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import * as jsoncParser from 'jsonc-eslint-parser';
import ts from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['**/node_modules/', '**/dist/', '**/coverage/', '**/package-lock.json']),
  js.configs.recommended,
  ts.configs.recommended,
  svelte.configs.recommended,
  // Disables the formatting rules that clash with Prettier and reports Prettier differences through ESLint.
  prettier,
  svelte.configs.prettier,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // TypeScript already checks undefined names; this rule gives false positives on types.
      'no-undef': 'off',
      'prettier/prettier': 'warn',
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parserOptions: {
        parser: ts.parser,
        extraFileExtensions: ['.svelte'],
      },
    },
  },
  {
    // JSON files are linted only for formatting, through the Prettier rule.
    files: ['**/*.json'],
    languageOptions: {
      parser: jsoncParser,
    },
  },
);
