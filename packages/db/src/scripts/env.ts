import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

/** Load the repo-root .env (if present) so scripts match the API's config. */
export function loadRootEnv(): void {
  const envFile = resolve(repoRoot, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

/** DATABASE_PATH is resolved relative to the repo root, as the API does. */
export function databasePathFromEnv(): string {
  loadRootEnv();
  const raw = process.env.DATABASE_PATH ?? './data/parksmart.db';
  return raw === ':memory:' || isAbsolute(raw) ? raw : resolve(repoRoot, raw);
}
