import { z } from 'zod';

// The only place the API reads environment variables. Everything else
// receives the validated AppConfig through dependency injection.
const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  // Validated now; the API connects to the database from task 2.6 (Prisma).
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
});

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
};

/** Injection token for AppConfig (see AppConfigModule). */
export const APP_CONFIG = Symbol('APP_CONFIG');

/**
 * Validates the environment and returns the API configuration.
 * Throws one error listing every invalid variable by name and reason.
 * Values are never included, so secrets cannot leak into logs.
 */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const result = envSchema.safeParse(env);

  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.')}: ${issue.message}`,
    );
    throw new Error(
      `Invalid environment configuration:\n${problems.join('\n')}`,
    );
  }

  return {
    nodeEnv: result.data.NODE_ENV,
    port: result.data.PORT,
    databaseUrl: result.data.DATABASE_URL,
  };
}
