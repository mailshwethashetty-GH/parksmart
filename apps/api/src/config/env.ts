import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';

const secret = z.string().min(32, 'must be at least 32 characters');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.url().default('http://localhost:5173'),
  DATABASE_PATH: z.string().default('./data/parksmart.db'),
  SESSION_SECRET: secret,
  QR_SIGNING_SECRET: secret,
  // An empty value (e.g. copied from .env.example) counts as unset.
  DEV_LOGIN_ENABLED: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['true', 'false']).optional(),
  ),
  SSO_GOOGLE_CLIENT_ID: z.string().optional(),
  SSO_GOOGLE_CLIENT_SECRET: z.string().optional(),
  SSO_ENTRA_TENANT_ID: z.string().optional(),
  SSO_ENTRA_CLIENT_ID: z.string().optional(),
  SSO_ENTRA_CLIENT_SECRET: z.string().optional(),
  DEFAULT_TIMEZONE: z.string().default('Asia/Kolkata'),
  LOG_LEVEL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  ),
});

export type Env = z.infer<typeof envSchema> & {
  /** Resolved: dev login is only ever on outside production. */
  devLoginEnabled: boolean;
};

export class EnvError extends Error {}

/**
 * Parse and check the environment. Throws (and the server refuses to start) when
 * config is invalid, including when dev login is switched on in production
 * (non-negotiable #6).
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env, repoRoot = process.cwd()): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new EnvError(`Invalid environment: ${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production' && env.DEV_LOGIN_ENABLED === 'true') {
    throw new EnvError('DEV_LOGIN_ENABLED=true is not allowed when NODE_ENV=production.');
  }
  const databasePath =
    env.DATABASE_PATH === ':memory:' || isAbsolute(env.DATABASE_PATH)
      ? env.DATABASE_PATH
      : resolve(repoRoot, env.DATABASE_PATH);
  return {
    ...env,
    DATABASE_PATH: databasePath,
    devLoginEnabled: env.NODE_ENV !== 'production' && env.DEV_LOGIN_ENABLED !== 'false',
  };
}
