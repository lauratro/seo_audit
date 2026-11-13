import type { INestApplication } from '@nestjs/common';

// App-wide settings shared by main.ts and the e2e tests,
// so tests exercise the same routes as the running server.
export function setupApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
}
