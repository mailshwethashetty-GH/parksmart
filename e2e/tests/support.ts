/** Helpers shared by the e2e specs: harness clock, sign-in, API calls, axe. */
import AxeBuilder from '@axe-core/playwright';
import { expect, type Browser, type Page } from '@playwright/test';
import { E2E_BASE, E2E_START } from '../harness/constants';

let current = E2E_START;
const pages = new Set<Page>();

/** Move the harness clock (and every open page's clock) forward. */
export async function setClock(iso: string) {
  const res = await fetch(`${E2E_BASE}/__e2e/clock`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ at: iso }),
  });
  if (!res.ok) throw new Error(`clock: ${res.status} ${await res.text()}`);
  current = iso;
  for (const p of pages) if (!p.isClosed()) await p.clock.setFixedTime(new Date(iso));
}

type TickResult = {
  rounds: { job: string; detail: Record<string, unknown> }[];
  notices: string[];
  email: { sent: number; held: number; skipped: number; failed: number };
};

/** One scheduler tick at the harness clock. */
export async function tick(): Promise<TickResult> {
  const res = await fetch(`${E2E_BASE}/__e2e/tick`, { method: 'POST' });
  if (!res.ok) throw new Error(`tick: ${res.status} ${await res.text()}`);
  return (await res.json()) as TickResult;
}

export async function sentMail(): Promise<{ to: string; subject: string; text: string }[]> {
  return ((await (await fetch(`${E2E_BASE}/__e2e/mail`)).json()) as { sent: never[] }).sent;
}

/** A fresh browser context signed in as a seeded user ("Meera Admin", "Divya Employee"…). */
export async function signIn(
  browser: Browser,
  name: string,
  viewport = { width: 1280, height: 900 },
): Promise<Page> {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(current));
  pages.add(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  (page as Page & { errors: string[] }).errors = errors;
  // The production web build hides the dev login (as it should), so sign in through
  // the harness API, which has it enabled (NODE_ENV=test).
  const email = `${name.split(' ')[0]!.toLowerCase()}@parksmart.test`;
  const local = email === 'meera@parksmart.test' ? 'admin@parksmart.test' : email;
  const res = await page.request.post('/api/v1/auth/dev/sign-in', {
    data: { email: email === 'gate@parksmart.test' ? 'security@parksmart.test' : local },
    headers: { origin: E2E_BASE },
  });
  if (!res.ok()) throw new Error(`dev sign-in ${name}: ${res.status()} ${await res.text()}`);
  await page.goto('/');
  await page.waitForURL((u) => u.pathname !== '/' && !u.pathname.startsWith('/login'));
  return page;
}

/** Uncaught errors seen on a page signed in with `signIn`. */
export const pageErrors = (page: Page) => (page as Page & { errors?: string[] }).errors ?? [];

/** Call the API as the page's user (same cookies, CSRF header on writes). */
export async function api<T = unknown>(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const headers: Record<string, string> = {};
      if (method !== 'GET') {
        const { token } = (await (await fetch('/api/v1/csrf-token')).json()) as { token: string };
        headers['x-csrf-token'] = token;
      }
      if (body !== undefined) headers['content-type'] = 'application/json';
      const res = await fetch(`/api/v1${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    },
    { method, path, body },
  );
}

/**
 * WCAG 2.1 AA check (docs/05). Fails on serious or critical violations; minor and
 * moderate ones are listed in the test output so they can be fixed without blocking.
 */
export async function expectAccessible(page: Page, screen: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  const minor = results.violations.filter((v) => !blocking.includes(v));
  if (minor.length) console.log(`[axe] ${screen}: ${minor.map((v) => v.id).join(', ')}`);
  expect(
    blocking.map(
      (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(' | ')})`,
    ),
    `axe violations on ${screen}`,
  ).toEqual([]);
}
