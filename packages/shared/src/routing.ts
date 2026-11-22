import type { Role } from './constants';

/** Landing route group for each role (docs/10-ux-flows.md). */
export function homePathForRole(role: Role): '/app' | '/admin' | '/gate' {
  switch (role) {
    case 'admin':
      return '/admin';
    case 'security':
      return '/gate';
    case 'employee':
      return '/app';
  }
}

/** Which roles may open each route group. Admins can also see the employee app. */
export const ROUTE_GROUP_ROLES: Record<'/app' | '/admin' | '/gate', readonly Role[]> = {
  '/app': ['employee', 'admin'],
  '/admin': ['admin'],
  '/gate': ['security', 'admin'],
};
