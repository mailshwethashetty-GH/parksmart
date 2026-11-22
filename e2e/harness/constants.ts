/** Shared by the harness and the specs. */
export const E2E_PORT = 4310;
export const E2E_BASE = `http://localhost:${E2E_PORT}`;
/** Monday 7 Dec 2026, 10:00 IST: the e2e world starts the week before the pilot week. */
export const E2E_START = '2026-12-07T04:30:00.000Z';

/** A site-local (IST) wall time as an ISO instant. */
export const ist = (date: string, time: string) =>
  new Date(`${date}T${time}:00+05:30`).toISOString();
