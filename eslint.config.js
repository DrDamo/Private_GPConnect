import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['**/dist', '.vercel', 'apps/web/public']),
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    // Copied verbatim from GP-Connect-Demo (see packages/gpc-fhir/PROVENANCE.md).
    // Kept byte-identical so it can be re-synced, so upstream style is tolerated
    // here rather than fixed in place.
    files: ['packages/gpc-fhir/src/fhir/**', 'packages/gpc-fhir/src/builder/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-irregular-whitespace': 'off',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
  },
])
