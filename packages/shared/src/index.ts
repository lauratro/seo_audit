export * from './api/api-error.js';

/** Response body of GET /api/health. */
export type HealthResponse = {
  status: 'ok';
};
