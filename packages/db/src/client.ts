import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema';

export type Schema = typeof schema;
export type Db = LibSQLDatabase<Schema> & { $client: Client };

export const DEFAULT_MIGRATIONS_FOLDER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../migrations',
);

export interface DbConfig {
  /** `libsql://…` (Turso), `http(s)://…`, or `file:/abs/path.db` for a local file. */
  url: string;
  /** Turso database token. Not needed for local files. */
  authToken?: string;
}

/** A local SQLite file path as a libSQL URL. */
export function fileUrl(path: string): string {
  return `file:${resolve(path)}`;
}

/**
 * Open the database (ADR-016): Turso in the hosted deployment, a local SQLite file in
 * development, tests and the Docker image. Same SQL dialect and constraints either way.
 */
export async function createDb(config: DbConfig | string): Promise<Db> {
  const { url, authToken } = typeof config === 'string' ? { url: config } : config;
  const local = url.startsWith('file:');
  if (local) mkdirSync(dirname(url.slice('file:'.length)), { recursive: true });
  const client = createClient({ url, ...(authToken ? { authToken } : {}) });
  if (local) {
    // WAL and a busy timeout for the local file; Turso manages its own storage.
    await client.execute('PRAGMA journal_mode = WAL');
    await client.execute('PRAGMA busy_timeout = 5000');
    await client.execute('PRAGMA synchronous = NORMAL');
  }
  await client.execute('PRAGMA foreign_keys = ON');
  return drizzle(client, { schema }) as Db;
}

export async function runMigrations(
  db: Db,
  migrationsFolder = DEFAULT_MIGRATIONS_FOLDER,
): Promise<void> {
  await migrate(db, { migrationsFolder });
}
