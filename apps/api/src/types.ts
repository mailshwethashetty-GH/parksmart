import type { Db } from '@parksmart/db';
import type { Role } from '@parksmart/shared';
import type { Auth } from './auth/auth';
import type { Env } from './config/env';

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
  }
  interface FastifyRequest {
    actor: Actor | null;
  }
}
