// Single ESLint config for the whole monorepo (run once from the root).
// Formatting is Prettier's job; ESLint only reports code-quality problems.
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import prettier from 'eslint-config-prettier/flat';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  // Build output and generated files are never linted.
  globalIgnores(['**/dist/', '**/coverage/', '**/.next/', '**/next-env.d.ts']),

  js.configs.recommended,

  // Type-aware rules (e.g. no-floating-promises, no-unsafe-*) for TypeScript.
  // projectService picks the nearest tsconfig.json for each file, so backend
  // and shared files are checked with their own compiler settings.
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Plain JS config files are not part of any tsconfig: lint them without types.
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // Frontend-only rules, added on top of the shared rules above (not copied).
  // eslint-config-next is not used: it bundles plugins that do not support
  // ESLint 10 yet, so only the two compatible plugins are enabled directly.
  {
    files: ['apps/frontend/**/*.{ts,tsx}'],
    extends: [
      nextPlugin.configs['core-web-vitals'],
      reactHooks.configs.flat.recommended,
    ],
    settings: { next: { rootDir: 'apps/frontend/' } },
  },

  // Must stay last: turns off any rule that would conflict with Prettier.
  prettier,
);
