import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@seo-audit/shared';

@Controller('health')
export class HealthController {
  @Get()
  check(): HealthResponse {
    return { status: 'ok' };
  }
}
