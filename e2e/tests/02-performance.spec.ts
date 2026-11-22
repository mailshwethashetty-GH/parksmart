/**
 * Performance checks from docs/05 and FR-21, against the real HTTP stack:
 * - booking API (create + withdraw) p95 < 500 ms
 * - check-in API (gate scan) p95 < 500 ms
 * - bay-sticker check-in completes in < 5 s on a throttled 4G connection, with the
 *   PWA already installed (the realistic case: employees open the installed app)
 *
 * Runs on Mon 21 Dec, after the pilot-week story, and sets up its own bookings.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { ist } from '../harness/constants';
import { api, setClock, signIn, tick } from './support';

test.describe.configure({ mode: 'serial' });

const TODAY = '2026-12-21';
const NEXT_WEEK = '2026-12-29';
const PEOPLE = ['Ananya Das', 'Rahul Shetty', 'Sneha Kulkarni', 'Vikram Singh', 'Farhan Ali'];
const SAMPLES = 40;

const p95 = (xs: number[]) => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!;
};

/** Timed API calls through the page's cookies, with the CSRF header on writes. */
async function client(page: Page) {
  const req: APIRequestContext = page.request;
  const { token } = (await (await req.get('/api/v1/csrf-token')).json()) as { token: string };
  const call = async (method: 'post' | 'delete', path: string, data?: unknown) => {
    const t0 = performance.now();
    const res = await req[method](`/api/v1${path}`, {
      headers: { 'x-csrf-token': token },
      ...(data === undefined ? {} : { data }),
    });
    return { ms: performance.now() - t0, status: res.status(), body: await res.json() };
  };
  return {
    post: (p: string, d: unknown) => call('post', p, d),
    del: (p: string) => call('delete', p),
  };
}

const pages: Record<string, Page> = {};

test.beforeAll(async ({ browser }) => {
  await setClock(ist(TODAY, '09:00'));
  for (const name of PEOPLE) pages[name] = await signIn(browser, name);
  // Everyone asks for today; the 09:00 same-day round offers bays; everyone accepts.
  for (const name of PEOPLE) {
    const res = await api(pages[name]!, 'POST', '/requests', {
      dates: [TODAY],
      bayType: 'car',
      arrivalWindow: '9_to_11',
      allowFallback: true,
    });
    expect(res.status).toBe(201);
  }
  await tick();
  for (const name of PEOPLE) {
    const items = (
      await api<{ items: { date: string; offer: { id: string } | null }[] }>(
        pages[name]!,
        'GET',
        '/requests',
      )
    ).body.items;
    const offer = items.find((r) => r.date === TODAY)?.offer;
    expect(offer, `${name} has an offer`).toBeTruthy();
    expect((await api(pages[name]!, 'POST', `/offers/${offer!.id}/accept`)).status).toBe(200);
  }
});

test(`booking API p95 < 500 ms (${SAMPLES} create + withdraw)`, async () => {
  const c = await client(pages['Ananya Das']!);
  const create: number[] = [];
  const withdraw: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const made = await c.post('/requests', {
      dates: [NEXT_WEEK],
      bayType: 'car',
      arrivalWindow: 'before_9',
      allowFallback: true,
    });
    expect(made.status).toBe(201);
    create.push(made.ms);
    const id = (made.body as { items: { id: string }[] }).items[0]!.id;
    const gone = await c.del(`/requests/${id}`);
    expect(gone.status).toBe(200);
    withdraw.push(gone.ms);
  }
  console.log(
    `[perf] create p95 ${p95(create).toFixed(0)} ms · withdraw p95 ${p95(withdraw).toFixed(0)} ms`,
  );
  expect(p95(create)).toBeLessThan(500);
  expect(p95(withdraw)).toBeLessThan(500);
});

test(`check-in API p95 < 500 ms (${SAMPLES} gate scans)`, async ({ browser }) => {
  const gate = await signIn(browser, 'Gate Security');
  const c = await client(gate);
  // Farhan is kept for the 4G check below.
  const tokens: string[] = [];
  for (const name of PEOPLE.filter((n) => n !== 'Farhan Ali')) {
    const page = pages[name]!;
    const items = (
      await api<{ items: { date: string; booking: { id: string } | null }[] }>(
        page,
        'GET',
        '/requests',
      )
    ).body.items;
    const booking = items.find((r) => r.date === TODAY)!.booking!;
    tokens.push(
      (await api<{ token: string }>(page, 'GET', `/bookings/${booking.id}/qr`)).body.token,
    );
  }
  const times: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    // The first pass checks people in; later passes are repeat scans ("already in").
    const res = await c.post('/checkins/scan', { token: tokens[i % tokens.length] });
    expect(res.status).toBe(200);
    times.push(res.ms);
  }
  console.log(`[perf] gate scan p95 ${p95(times).toFixed(0)} ms`);
  expect(p95(times)).toBeLessThan(500);
  await gate.context().close();
});

test('bay-sticker check-in completes in < 5 s on 4G (installed PWA)', async ({ browser }) => {
  const farhan = pages['Farhan Ali']!;
  const meera = await signIn(browser, 'Meera Admin');
  const items = (
    await api<{ items: { date: string; booking: { bayCode: string } | null }[] }>(
      farhan,
      'GET',
      '/requests',
    )
  ).body.items;
  const bayCode = items.find((r) => r.date === TODAY)!.booking!.bayCode;
  const bays = (await api<{ items: { id: string; code: string }[] }>(meera, 'GET', '/admin/bays'))
    .body.items;
  const bayId = bays.find((b) => b.code === bayCode)!.id;
  const { token } = (await api<{ token: string }>(meera, 'GET', `/admin/bays/${bayId}/qr`)).body;
  await meera.context().close();

  // Install: first visit registers the service worker and precaches the app shell.
  await farhan.goto('/app');
  await farhan.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await farhan.reload();

  // Throttle like a weak 4G link (Lighthouse "slow 4G": 150 ms RTT, 1.6 Mbps down).
  const cdp = await farhan.context().newCDPSession(farhan);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });

  const t0 = Date.now();
  await farhan.goto(`/app/checkin?bay=${encodeURIComponent(token)}`);
  await expect(farhan.getByText("You're checked in.")).toBeVisible({ timeout: 10_000 });
  const ms = Date.now() - t0;
  console.log(`[perf] bay-sticker check-in on 4G: ${ms} ms`);
  expect(ms).toBeLessThan(5_000);
});

test('first visit on 4G, no cache (reported, not asserted)', async ({ browser }) => {
  // Without the installed PWA the whole bundle downloads. The harness serves it
  // uncompressed; production gzips through Caddy, so this is a pessimistic figure.
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  const t0 = Date.now();
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Meera Admin' })).toBeVisible({
    timeout: 30_000,
  });
  console.log(`[perf] first visit on 4G, uncompressed: ${Date.now() - t0} ms`);
  await context.close();
});
