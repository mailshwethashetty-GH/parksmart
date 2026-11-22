import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';

const secret = z.string().min(32, 'must be at least 32 characters');
/** An empty value (e.g. copied from .env.example) counts as unset. */
const optionalString = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().trim().optional(),
);

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
  // SSO (docs/06). One identity provider per deployment, matched by email domain.
  ORG_EMAIL_DOMAIN: optionalString,
  SSO_GOOGLE_CLIENT_ID: optionalString,
  SSO_GOOGLE_CLIENT_SECRET: optionalString,
  SSO_ENTRA_TENANT_ID: optionalString,
  SSO_ENTRA_CLIENT_ID: optionalString,
  SSO_ENTRA_CLIENT_SECRET: optionalString,
  // First run only: create the org and pilot site when the database is empty.
  SETUP_ORG_NAME: optionalString,
  SETUP_SITE_NAME: optionalString,
  // Comma-separated. These people become admins the first time they sign in.
  INITIAL_ADMIN_EMAILS: optionalString,
  DEFAULT_TIMEZONE: z.string().default('Asia/Kolkata'),
  // Claude API (optional: without a key, reasons stay as templates).
  ANTHROPIC_API_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  AI_MODEL_FAST: z.string().default('claude-haiku-5-5'),
  AI_MODEL_SMART: z.string().default('claude-sonnet-5-5'),
  // Email (optional: without SMTP, emails are logged instead of sent).
  SMTP_HOST: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  SMTP_PASS: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  MAIL_FROM: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  // Error monitoring (optional).
  SENTRY_DSN: z.preprocess((v) => (v === '' ? undefined : v), z.url().optional()),
  LOG_LEVEL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  ),
});

export type SsoProvider = 'google' | 'entra';

export type Env = z.infer<typeof envSchema> & {
  /** Resolved: dev login is only ever on outside production. */
  devLoginEnabled: boolean;
  /** The configured identity provider, if any. */
  ssoProvider: SsoProvider | null;
  /** Lower-cased INITIAL_ADMIN_EMAILS. */
  initialAdminEmails: string[];
};

function resolveSso(env: z.infer<typeof envSchema>): SsoProvider | null {
  const google = [env.SSO_GOOGLE_CLIENT_ID, env.SSO_GOOGLE_CLIENT_SECRET];
  const entra = [env.SSO_ENTRA_TENANT_ID, env.SSO_ENTRA_CLIENT_ID, env.SSO_ENTRA_CLIENT_SECRET];
  const state = (vals: (string | undefined)[]) =>
    vals.every(Boolean) ? 'complete' : vals.some(Boolean) ? 'partial' : 'none';
  const g = state(google);
  const e = state(entra);
  if (g === 'partial')
    throw new EnvError('Set both SSO_GOOGLE_CLIENT_ID and SSO_GOOGLE_CLIENT_SECRET.');
  if (e === 'partial')
    throw new EnvError('Set SSO_ENTRA_TENANT_ID, SSO_ENTRA_CLIENT_ID and SSO_ENTRA_CLIENT_SECRET.');
  if (g === 'complete' && e === 'complete')
    throw new EnvError('Configure one identity provider: Google or Microsoft Entra, not both.');
  const provider = g === 'complete' ? 'google' : e === 'complete' ? 'entra' : null;
  if (provider && !env.ORG_EMAIL_DOMAIN)
    throw new EnvError('ORG_EMAIL_DOMAIN is required with SSO (e.g. example.com).');
  return provider;
}

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
  const ssoProvider = resolveSso(env);
  if (env.NODE_ENV === 'production' && !ssoProvider) {
    // SSO is the only way in (non-negotiable #6): without it nobody could sign in.
    throw new EnvError(
      'Production needs an identity provider: set SSO_GOOGLE_* or SSO_ENTRA_* and ORG_EMAIL_DOMAIN.',
    );
  }
  if (
    (env.SETUP_ORG_NAME || env.SETUP_SITE_NAME) &&
    !(env.SETUP_ORG_NAME && env.SETUP_SITE_NAME && env.ORG_EMAIL_DOMAIN)
  ) {
    throw new EnvError(
      'First-run setup needs SETUP_ORG_NAME, SETUP_SITE_NAME and ORG_EMAIL_DOMAIN.',
    );
  }
  const databasePath =
    env.DATABASE_PATH === ':memory:' || isAbsolute(env.DATABASE_PATH)
      ? env.DATABASE_PATH
      : resolve(repoRoot, env.DATABASE_PATH);
  return {
    ...env,
    DATABASE_PATH: databasePath,
    devLoginEnabled: env.NODE_ENV !== 'production' && env.DEV_LOGIN_ENABLED !== 'false',
    ssoProvider,
    initialAdminEmails: (env.INITIAL_ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  };
}
