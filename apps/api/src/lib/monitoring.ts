/**
 * Error monitoring (docs/06: Sentry). Off unless SENTRY_DSN is set. Events carry no
 * personal data (non-negotiable 7): no user, cookies, query strings or bodies (bodies
 * can hold vehicle plates or reasons), and only the user-agent header.
 */
import * as Sentry from '@sentry/node';

let enabled = false;

type SentryEvent = Parameters<NonNullable<Sentry.NodeOptions['beforeSend']>>[0];

export function scrubEvent<E extends SentryEvent>(event: E): E {
  delete event.user;
  if (event.request) {
    const ua = event.request.headers?.['user-agent'];
    delete event.request.cookies;
    delete event.request.data;
    delete event.request.query_string;
    event.request.headers = ua ? { 'user-agent': ua } : {};
  }
  return event;
}

export function initMonitoring(opts: { dsn?: string; environment: string; release?: string }) {
  if (!opts.dsn) return false;
  Sentry.init({
    dsn: opts.dsn,
    environment: opts.environment,
    release: opts.release,
    // Sentry 11 collects all of these by default. Turn every one off; scrubEvent below
    // is a second layer. AI prompts must never leave through monitoring either.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ['user-agent'] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
      databaseQueryData: false,
    },
    tracesSampleRate: 0,
    beforeSend: (event) => scrubEvent(event),
  });
  enabled = true;
  return true;
}

/** Report an unexpected error (5xx or a failed job). A no-op when monitoring is off. */
export function reportError(err: unknown, tags: Record<string, string> = {}) {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    scope.setTags(tags);
    Sentry.captureException(err);
  });
}

export async function flushMonitoring() {
  if (enabled) await Sentry.flush(2000);
}
