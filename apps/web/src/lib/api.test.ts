import { CSRF_HEADER } from '@parksmart/shared';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, createApiClient } from './api';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('api client', () => {
  it('parses the standard error body into ApiError', async () => {
    const fetchMock = vi.fn(async () =>
      json(401, { error: { code: 'UNAUTHENTICATED', message: 'Sign in required.', details: {} } }),
    );
    const api = createApiClient(fetchMock as typeof fetch);
    await expect(api.get('/me', z.unknown())).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
    await expect(api.get('/me', z.unknown())).rejects.toBeInstanceOf(ApiError);
  });

  it('sends the CSRF header on mutations and retries once with a fresh token', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    let tokenCount = 0;
    let posts = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      if (url.endsWith('/csrf-token')) return json(200, { token: `t${++tokenCount}` });
      posts++;
      return posts === 1
        ? json(403, { error: { code: 'CSRF_INVALID', message: 'bad', details: {} } })
        : json(200, { ok: true });
    });
    const api = createApiClient(fetchMock as unknown as typeof fetch);
    await expect(api.post('/things', z.object({ ok: z.boolean() }))).resolves.toEqual({ ok: true });
    const postHeaders = calls
      .filter((c) => c.url.endsWith('/things'))
      .map((c) => c.headers[CSRF_HEADER]);
    expect(postHeaders).toEqual(['t1', 't2']);
  });

  it('does not send CSRF to Better Auth routes', async () => {
    const fetchMock = vi.fn(async () => json(200, {}));
    const api = createApiClient(fetchMock as unknown as typeof fetch);
    await api.post('/auth/sign-out', z.unknown());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
