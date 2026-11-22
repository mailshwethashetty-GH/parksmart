import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DbConfig } from '../client';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

/** Load the repo-root .env (if present) so scripts match the API's config. */
export function loadRootEnv(): void {
  const envFile = resolve(repoRoot, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

/**
 * The database the API uses: DATABASE_URL (+ DATABASE_AUTH_TOKEN) for Turso, else the
 * local file at DATABASE_PATH, resolved relative to the repo root as the API does.
 */
export function dbConfigFromEnv(): DbConfig & { label: string } {
  loadRootEnv();
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    const authToken = process.env.DATABASE_AUTH_TOKEN?.trim() || undefined;
    return { url, authToken, label: url.replace(/\?.*$/, '') };
  }
  const raw = process.env.DATABASE_PATH ?? './data/parksmart.db';
  const path = isAbsolute(raw) ? raw : resolve(repoRoot, raw);
  return { url: `file:${path}`, label: path };
}
