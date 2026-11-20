export * from './checks/index.js';
export { normalizeUrl } from './url/normalize-url.js';

/** Response body of GET /api/health. */
export type HealthResponse = {
  status: 'ok';
};
