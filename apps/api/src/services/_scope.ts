import { conflict, forbidden, notFound } from '../lib/errors';

/**
 * Site scoping for resources fetched by id: 404 if missing, 403 if it belongs to
 * another site (docs/09: "403 wrong role or wrong site").
 */
export function assertInSite<T extends { siteId: string }>(
  row: T | undefined,
  siteId: string,
  what: string,
): T {
  if (!row) throw notFound(what);
  if (row.siteId !== siteId) throw forbidden(`This ${what.toLowerCase()} belongs to another site.`);
  return row;
}

/** A UNIQUE constraint failure, from libSQL directly or wrapped by Drizzle (`cause`). */
export function isUniqueViolation(err: unknown): boolean {
  for (
    let e = err as {
      code?: string;
      extendedCode?: string;
      message?: string;
      cause?: unknown;
    } | null;
    e;
    e = e.cause as typeof e
  ) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE' || e.extendedCode === 'SQLITE_CONSTRAINT_UNIQUE')
      return true;
    if (e.code === 'SQLITE_CONSTRAINT' && /UNIQUE constraint failed/.test(e.message ?? ''))
      return true;
  }
  return false;
}

/** Run `fn`, turning a UNIQUE violation into a 409 with `message`. */
export async function withUniqueConflict<T>(fn: () => T, message: string): Promise<Awaited<T>> {
  try {
    return await fn();
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict(message);
    throw err;
  }
}

export const iso = (d: Date) => d.toISOString();
