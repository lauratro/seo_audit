import { Global, Module } from '@nestjs/common';

import { APP_CONFIG, loadConfig, type AppConfig } from '../config.js';

// Registers the validated config once, under the APP_CONFIG token.
// @Global() makes it injectable in every module without re-importing:
//   constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}
// The factory runs while the app starts, so invalid env stops startup.
@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => loadConfig(process.env),
    },
  ],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
