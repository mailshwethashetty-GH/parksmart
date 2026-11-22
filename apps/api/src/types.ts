import type { Db } from '@parksmart/db';
import type { Role } from '@parksmart/shared';
import type { Auth } from './auth/auth';
import type { AiClient } from './ai/client';
import type { Env } from './config/env';
import type { EventBus } from './lib/events';
import type { Mailer } from './lib/mailer';

/** The signed-in user, set by `requireRole`. Site scoping comes from here. */
export type Actor = {
  id: string;
  orgId: string;
  siteId: string;
  role: Role;
};

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    env: Env;
    auth: Auth;
    /** Current time. Injected so tests can control it; services never call the clock. */
    clock: () => Date;
    /** Claude client, or null when no API key is configured. */
    ai: AiClient | null;
    events: EventBus;
    mailer: Mailer;
  }
  interface FastifyRequest {
    actor: Actor | null;
  }
}
