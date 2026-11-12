import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'dist-*', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: globals.browser } },
  {
    // core/ must stay DOM-free so it is unit-testable.
    files: ['src/core/**/*.ts'],
    languageOptions: { globals: { ...globals.es2021 } },
    rules: {
      'no-restricted-globals': ['error', 'document', 'window', 'HTMLElement', 'HTMLCanvasElement', 'CanvasRenderingContext2D', 'localStorage'],
    },
  },
  {
    // Browser smoke test: a Node script that drives pages via page.evaluate.
    files: ['e2e/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
