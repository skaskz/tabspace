import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', 'playwright-report', 'test-results', 'tests/e2e/_tmp', 'promo'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node, chrome: 'readonly' } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  { files: ['scripts/**/*.mjs', 'tests/visual/**/*.mjs'], languageOptions: { globals: { ...globals.node, ...globals.browser, chrome: 'readonly' } } },
  // Playwright fixtures call `use()`, which is not a React hook.
  { files: ['tests/e2e/**/*.ts'], rules: { 'react-hooks/rules-of-hooks': 'off', 'no-empty-pattern': 'off' } },
);
