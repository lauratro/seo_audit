// Single ESLint config for the whole monorepo (run once from the root).
// Formatting is Prettier's job; ESLint only reports code-quality problems.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  // Build output and generated files are never linted.
  globalIgnores(['**/dist/', '**/coverage/', '**/.next/']),

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

  // Frontend-only rules go here once apps/frontend exists, scoped with
  // `files: ['apps/frontend/**']` (e.g. eslint-config-next). They are added
  // on top of the shared rules above, not copied.

  // Must stay last: turns off any rule that would conflict with Prettier.
  prettier,
);
