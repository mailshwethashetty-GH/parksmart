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

export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

/** Run `fn`, turning a UNIQUE violation into a 409 with `message`. */
export function withUniqueConflict<T>(fn: () => T, message: string): T {
  try {
    return fn();
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict(message);
    throw err;
  }
}

export const iso = (d: Date) => d.toISOString();
