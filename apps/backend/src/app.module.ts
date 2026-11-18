import { Module } from '@nestjs/common';

import { AppConfigModule } from './config/module/app-config.module.js';
import { HealthModule } from './health/module/health.module.js';

@Module({
  imports: [AppConfigModule, HealthModule],
})
export class AppModule {}
