import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
  },
  // Vitest's default transform (esbuild) does not emit decorator metadata,
  // which NestJS needs for dependency injection. SWC does.
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
