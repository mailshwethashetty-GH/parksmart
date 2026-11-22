/**
 * The pilot week, end to end (docs/10 key flows 1–7), on one harness whose clock the
 * test moves forward. Every screen visited gets an axe WCAG 2.1 AA check.
 *
 * Timeline (IST):
 *   Mon 7 Dec 10:00  Meera changes the rules (flow 3) and blocks bays for an event (flow 5);
 *                    Divya requests Tue–Thu next week (flow 1)
 *   Fri 11 Dec 12:01 weekly round runs; Meera overrides one decision and approves (flow 4)
 *   Tue 15 Dec 08:30 Divya's QR is scanned at the gate (flow 7)
 *   Tue 15 Dec 09:00 Priya asks for today and accepts a same-day offer (flow 2)
 *   Tue 15 Dec 09:16 Karthik never arrived: his bay is auto-released
 *   Wed 16 Dec 10:00 Meera reads the analytics and downloads the monthly export (flow 6)
 */
import { expect, test, type Page } from '@playwright/test';
import { ist } from '../harness/constants';
import { api, expectAccessible, pageErrors, sentMail, setClock, signIn, tick } from './support';

test.describe.configure({ mode: 'serial' });

type RequestItem = {
  id: string;
  date: string;
  status: string;
  booking: { id: string; bayCode: string; status: string } | null;
  offer: { id: string } | null;
};
const requestsOf = async (page: Page) =>
  (await api<{ items: RequestItem[] }>(page, 'GET', '/requests')).body.items;

let meera: Page;
let divya: Page;

test.beforeAll(async ({ browser }) => {
  meera = await signIn(browser, 'Meera Admin');
  divya = await signIn(browser, 'Divya Employee');
});

test.afterAll(() => {
  expect(pageErrors(meera)).toEqual([]);
  expect(pageErrors(divya)).toEqual([]);
});

test('login screen is accessible', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Continue with SSO' })).toBeVisible();
  await expectAccessible(page, '/login');
});

test('flow 3: Meera changes a weight and publishes from next week', async () => {
  await meera.goto('/admin/policy');
  await meera.getByRole('button', { name: 'New draft' }).click();
  await expect(meera.getByText(/Draft v\d+/).first()).toBeVisible();
  await meera.getByLabel(/Weight for Rolling fairness/).fill('40');
  await meera.getByLabel(/Weight for Seniority/).fill('0');
  await expect(meera.getByText('100%', { exact: true })).toBeVisible();
  await meera.getByRole('button', { name: 'Save draft' }).click();
  await expect(meera.getByText(/Takes effect from the next weekly round/)).toBeVisible();
  await expectAccessible(meera, '/admin/policy (draft)');
  await meera.getByLabel('Reason for the change').fill('Pilot: weight fairness more heavily');
  await meera.getByRole('button', { name: 'Publish', exact: true }).click();
  // Rule 8: never mid-round. It takes effect from next week's round.
  await expect(meera.getByText(/Scheduled/).first()).toBeVisible();
  await expect(meera.getByText(/week of .*14 Dec/).first()).toBeVisible();
});

test('flow 5: Meera blocks two bays for an event on Wed 16 Dec', async () => {
  await meera.goto('/admin/site?tab=blocks');
  await meera.getByLabel('Block').selectOption('bays');
  await meera.getByLabel('Bay codes').fill('B1-001, B1-002');
  await meera.getByLabel('From').fill('2026-12-16');
  await meera.getByLabel('Reason').fill('Client visit: bays reserved for guests');
  await meera.getByRole('button', { name: 'Block bays' }).click();
  await expect(meera.getByText('Client visit: bays reserved for guests').first()).toBeVisible();
  await expectAccessible(meera, '/admin/site?tab=blocks');
});

test('flow 1 (request): Divya asks for Tue–Thu next week', async () => {
  await divya.goto('/app/book');
  for (const day of ['Tue 15 Dec', 'Wed 16 Dec', 'Thu 17 Dec'])
    await divya.getByRole('button', { name: new RegExp(`^${day}`) }).click();
  await expect(divya.getByText(/Who decides/)).toBeVisible();
  await expectAccessible(divya, '/app/book');
  await divya.getByRole('button', { name: 'Request 3 days' }).click();
  await expect(divya.getByText(/Requested 3 day/)).toBeVisible();

  // Other people ask too, so the round has real decisions.
  for (const name of ['Arjun Rao', 'Karthik Menon']) {
    const page = await signIn(divya.context().browser()!, name);
    const res = await api(page, 'POST', '/requests', {
      dates: ['2026-12-15', '2026-12-16'],
      bayType: 'car',
      arrivalWindow: 'before_9',
      allowFallback: true,
    });
    expect(res.status).toBe(201);
    await page.context().close();
  }
  await divya.goto('/app');
  await expect(divya.getByText('Tue 15 Dec')).toBeVisible();
  await expectAccessible(divya, '/app');
  await divya.goto('/app/policy');
  await expectAccessible(divya, '/app/policy');
});

test('submission time is not an advantage: nothing runs before Friday', async () => {
  await setClock(ist('2026-12-11', '11:59'));
  const out = await tick();
  expect(out.rounds.filter((r) => r.job === 'weekly-round')).toEqual([]);
});

test('flow 4: weekly round runs; Meera overrides one decision and approves', async () => {
  await setClock(ist('2026-12-11', '12:01'));
  const out = await tick();
  expect(out.rounds.map((r) => r.job)).toContain('weekly-round');

  await meera.goto('/admin/collation');
  await expectAccessible(meera, '/admin/collation');
  await meera.goto('/admin/rounds');
  await expectAccessible(meera, '/admin/rounds');
  await meera.getByRole('link', { name: 'Weekly round' }).click();
  await expect(meera.getByText('Approve and publish')).toBeVisible();
  // The round used the newly scheduled policy (v2), not the one in force today.
  await expect(meera.getByText(/policy v2/)).toBeVisible();
  await expectAccessible(meera, '/admin/rounds/:id');

  const arjunRow = meera.locator('tr', { hasText: 'Arjun Rao' }).first();
  await arjunRow.getByRole('button', { name: 'Move to waitlist' }).click();
  await arjunRow.getByLabel('Reason (required)').fill('Arjun is travelling on Tuesday');
  await arjunRow.getByRole('button', { name: 'Save' }).click();
  await expect(
    meera.locator('tr', { hasText: 'Arjun Rao' }).getByText('overridden').first(),
  ).toBeVisible();

  await meera.getByRole('button', { name: /Approve \(/ }).click();
  await expect(meera.getByText('Published').first()).toBeVisible();

  await meera.goto('/admin/audit');
  await expect(meera.getByText('allocation.override').first()).toBeVisible();
  await expectAccessible(meera, '/admin/audit');
});

test('flow 1 (result): Divya sees her bays, the reason and a notice', async () => {
  await divya.goto('/app');
  await expect(divya.getByText(/Your bay: B1-/).first()).toBeVisible();
  const mine = await requestsOf(divya);
  const wed = mine.find((r) => r.date === '2026-12-16')!;
  // The event block holds: Divya never gets a blocked bay on Wed.
  expect(['B1-001', 'B1-002']).not.toContain(wed.booking?.bayCode);

  const bell = divya.getByRole('button', { name: /^Notifications/ });
  await expect(bell).toHaveAttribute('aria-label', /unread/);
  await bell.click();
  await expect(divya.getByRole('region', { name: 'Notifications' })).toContainText(/confirmed/);
  await expectAccessible(divya, 'inbox');
  await divya.keyboard.press('Escape');

  // Email goes out on the next scheduler tick.
  await tick();
  const mail = await sentMail();
  expect(mail.some((m) => m.to.startsWith('divya@') && /confirmed/.test(m.subject))).toBe(true);
});

test('flow 7: the gate scans Divya’s QR on Tue morning', async ({ browser }) => {
  await setClock(ist('2026-12-15', '08:30'));
  const tue = (await requestsOf(divya)).find((r) => r.date === '2026-12-15')!;
  expect(tue.booking?.status).toBe('confirmed');
  await divya.goto('/app');
  await divya.getByRole('button', { name: 'Show QR code' }).first().click();
  const { token } = (await api<{ token: string }>(divya, 'GET', `/bookings/${tue.booking!.id}/qr`))
    .body;

  const gate = await signIn(browser, 'Gate Security');
  await gate.goto('/gate');
  await expectAccessible(gate, '/gate');
  // A hardware scanner types the code and presses Enter.
  await gate.getByLabel('Scanned code').fill(token);
  await gate.getByLabel('Scanned code').press('Enter');
  await expect(gate.getByText(/· checked in$/).first()).toBeVisible();
  expect(pageErrors(gate)).toEqual([]);
  await gate.context().close();
});

test('flow 2: Priya asks for today and accepts a same-day offer', async ({ browser }) => {
  await setClock(ist('2026-12-15', '09:00'));
  const priya = await signIn(browser, 'Priya Iyer');
  const res = await api(priya, 'POST', '/requests', {
    dates: ['2026-12-15'],
    bayType: 'car',
    arrivalWindow: '9_to_11',
    allowFallback: true,
  });
  expect(res.status).toBe(201);
  const out = await tick();
  expect(out.rounds.map((r) => r.job)).toContain('same-day-round');

  await priya.goto('/app');
  const offer = priya.getByRole('region', { name: 'Bay offer' });
  await expect(offer).toBeVisible();
  await expectAccessible(priya, '/app (offer)');
  await offer.getByRole('button', { name: 'Accept' }).click();
  await expect(priya.getByText(/Your bay:/).first()).toBeVisible();
  expect(pageErrors(priya)).toEqual([]);
  await priya.context().close();
});

test('no-show: Karthik never checks in and his bay is released', async () => {
  await setClock(ist('2026-12-15', '09:16'));
  const out = await tick();
  expect(out.rounds.map((r) => r.job)).toContain('auto-release');
});

test('flow 6: Meera reads analytics and downloads the monthly export', async () => {
  await setClock(ist('2026-12-16', '10:00'));
  await tick();
  await meera.goto('/admin/analytics');
  await expect(meera.getByText('Peak-day utilisation')).toBeVisible();
  await expect(meera.getByLabel('Month')).toHaveValue('2026-12');
  await expectAccessible(meera, '/admin/analytics');
  await meera.getByRole('button', { name: 'Show as table' }).click();
  await expect(meera.getByRole('cell', { name: /Tue 15 Dec/ })).toBeVisible();

  const [download] = await Promise.all([
    meera.waitForEvent('download'),
    meera.getByRole('link', { name: 'Download CSV' }).click(),
  ]);
  const csv = await (await download.createReadStream()).toArray();
  const text = Buffer.concat(csv).toString('utf8');
  expect(text).toContain('"Month","2026-12"');
  expect(text).toMatch(/"2026-12-15","yes"/);
});

test('profile and data rights screens are accessible', async () => {
  await divya.goto('/app/profile');
  await expect(divya.getByRole('heading', { name: 'Profile' })).toBeVisible();
  await expectAccessible(divya, '/app/profile');
  await meera.goto('/admin');
  await expectAccessible(meera, '/admin');
  await meera.goto('/admin/site');
  await expectAccessible(meera, '/admin/site');
});

test('roles: Meera makes a new gate guard Security, with a reason', async ({ browser }) => {
  await meera.goto('/admin/site?tab=people');
  await meera.getByLabel('Search people').fill('Lakshmi');
  await meera.getByRole('button', { name: 'Change role for Lakshmi Narayan' }).click();
  await meera.getByLabel('Role').selectOption('security');
  await meera.getByLabel('Reason (required)').fill('Joins the gate team');
  await expectAccessible(meera, '/admin/site?tab=people');
  await meera.getByRole('button', { name: 'Save' }).click();
  await expect(meera.getByRole('cell', { name: 'Security' })).toBeVisible();

  const lakshmi = await signIn(browser, 'Lakshmi Narayan');
  await lakshmi.goto('/gate');
  await expect(lakshmi.getByText("Today's bookings")).toBeVisible();
  await lakshmi.context().close();
});
