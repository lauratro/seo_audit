import { Module } from '@nestjs/common';

import { HealthModule } from './health/module/health.module.js';

@Module({
  imports: [HealthModule],
})
export class AppModule {}
