import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    // Tests never read .env: the e2e tests boot AppModule, whose config
    // module needs these. Dummy values; no database is contacted.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5433/seo_audit_test',
    },
  },
  // Vitest's default transform (esbuild) does not emit decorator metadata,
  // which NestJS needs for dependency injection. SWC does.
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
