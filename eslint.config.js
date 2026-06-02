import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

function warnify(rules = {}) {
  return Object.fromEntries(
    Object.entries(rules).map(([name, value]) => {
      if (Array.isArray(value)) return [name, ['warn', ...value.slice(1)]];
      if (value === 'off' || value === 0) return [name, value];
      return [name, 'warn'];
    }),
  );
}

const tsRecommended = tseslint.configs.recommended.map((config) => ({
  ...config,
  rules: warnify(config.rules),
}));

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'dist-ssr/**',
      'data/**',
      '.scratch/**',
      '.vite/**',
      'coverage/**',
    ],
  },
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.es2024,
        ...globals.node,
      },
    },
    rules: warnify(js.configs.recommended.rules),
  },
  ...tsRecommended,
  {
    files: ['client/src/**/*.{ts,tsx}', 'client/vite.config.ts'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2024,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['**/*.test.{js,ts,tsx}', 'vitest.config.js', 'vitest.workspace.*'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2024,
      },
    },
  },
  prettier,
);
