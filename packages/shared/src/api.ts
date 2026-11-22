/**
 * Request/response schemas shared by the API and the web app.
 * Conventions: docs/09-api-conventions.md.
 */
import { z } from 'zod';
import { ROLES } from './constants';

export const API_BASE = '/api/v1';
export const AUTH_BASE = `${API_BASE}/auth`;
export const CSRF_HEADER = 'x-csrf-token';

export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'BUSINESS_RULE',
  'RATE_LIMITED',
  'CSRF_INVALID',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number] | (string & {});

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).default({}),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  db: z.literal('ok'),
  time: z.string(),
});

export const roleSchema = z.enum(ROLES);

export const meResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: roleSchema,
  org: z.object({ id: z.string(), name: z.string() }),
  site: z.object({ id: z.string(), name: z.string(), timezone: z.string() }),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const csrfTokenResponseSchema = z.object({ token: z.string() });

export const devUserSchema = z.object({
  email: z.string(),
  name: z.string(),
  role: roleSchema,
});
export const devUsersResponseSchema = z.object({ items: z.array(devUserSchema) });
export const devSignInBodySchema = z.object({ email: z.email() });
