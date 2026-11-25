import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  Logger,
} from '@nestjs/common';

import { toApiError } from '../fetch-error-mapping.js';
import { FetcherError } from '../fetcher.errors.js';

/** The part of the HTTP response the filter uses (Express-compatible). */
interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

/**
 * Turns typed SafeFetcher errors into API error responses at the HTTP
 * boundary (docs/adr/0002-safe-fetcher.md, rule 9). @Catch(FetcherError)
 * means every other exception keeps the NestJS default handling.
 */
@Catch(FetcherError)
export class FetcherExceptionFilter implements ExceptionFilter<FetcherError> {
  private readonly logger = new Logger(FetcherExceptionFilter.name);

  catch(error: FetcherError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();
    const body = toApiError(error);

    // Internal details (e.g. a resolved address in the cause) go to the
    // server log only, never into the response.
    const cause =
      error.cause instanceof Error ? ` (${error.cause.message})` : '';

    if (!body) {
      this.logger.error(`Unmapped ${error.name}: ${error.message}${cause}`);
      response
        .status(500)
        .json({ statusCode: 500, message: 'Internal server error' });
      return;
    }

    this.logger.warn(`${error.name}: ${error.message}${cause}`);
    response.status(body.statusCode).json(body);
  }
}
