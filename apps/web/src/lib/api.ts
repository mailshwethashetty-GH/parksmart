/**
 * Typed API client. The web app talks to the API only through this module
 * (docs/07-architecture.md). Responses are validated with the shared Zod schemas.
 */
import { API_BASE, CSRF_HEADER, errorResponseSchema } from '@parksmart/shared';
import type { z } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

type FetchLike = typeof fetch;

export function createApiClient(fetchImpl: FetchLike = (...args) => fetch(...args)) {
  let csrfToken: string | null = null;

  async function getCsrfToken(force = false): Promise<string> {
    if (csrfToken && !force) return csrfToken;
    const res = await fetchImpl(`${API_BASE}/csrf-token`, { credentials: 'same-origin' });
    csrfToken = ((await res.json()) as { token: string }).token;
    return csrfToken;
  }

  async function toError(res: Response): Promise<ApiError> {
    const parsed = errorResponseSchema.safeParse(await res.json().catch(() => null));
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      return new ApiError(res.status, code, message, details);
    }
    return new ApiError(res.status, 'UNKNOWN', `Request failed (${res.status}).`);
  }

  async function request<S extends z.ZodType>(
    method: string,
    path: string,
    schema: S,
    body?: unknown,
    retried = false,
  ): Promise<z.infer<S>> {
    const mutating = method !== 'GET';
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (mutating && !path.startsWith('/auth/')) headers[CSRF_HEADER] = await getCsrfToken();

    const res = await fetchImpl(`${API_BASE}${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const error = await toError(res);
      if (error.code === 'CSRF_INVALID' && !retried) {
        await getCsrfToken(true);
        return request(method, path, schema, body, true);
      }
      throw error;
    }
    return schema.parse(res.status === 204 ? undefined : await res.json());
  }

  return {
    get: <S extends z.ZodType>(path: string, schema: S) => request('GET', path, schema),
    post: <S extends z.ZodType>(path: string, schema: S, body?: unknown) =>
      request('POST', path, schema, body ?? {}),
    patch: <S extends z.ZodType>(path: string, schema: S, body: unknown) =>
      request('PATCH', path, schema, body),
    delete: <S extends z.ZodType>(path: string, schema: S) => request('DELETE', path, schema),
  };
}

export const api = createApiClient();
