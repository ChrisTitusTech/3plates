import { test, expect, type Page } from '@playwright/test';
import { sample } from '../../whoop/web/demo';
import type { HealthLog, HealthMutation } from '@3plates/contract';
const user = { id: '00000000-0000-4000-8000-000000000001', email: 'synthetic@example.test', displayName: 'Synthetic Athlete' };
async function setup(page: Page, signedIn = true) {
  let offline = false;
  let dashboardReads = 0;
  let activeUser = user;
  const logs = new Map<string, HealthLog>();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  if (signedIn) await page.addInitScript((user) => {
    localStorage.setItem('@3plates/session-token', 'synthetic-session');
    localStorage.setItem('@3plates/cache/me', JSON.stringify({ value: user, updatedAt: new Date().toISOString() }));
  }, user);
  await page.route('**/*', async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin === 'http://127.0.0.1:4173') return route.continue();
    if (offline) return route.abort('failed');
    const send = (json: unknown, status = 200) => route.fulfill({ status, json, headers: { 'access-control-allow-origin': '*' } });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    switch (url.pathname) {
      case '/auth/providers': return send({ providers: ['google', 'apple', 'whoop'] });
      case '/users/me': return send(activeUser);
      case '/users/me/preferences': return send({ theme: 'system', units: 'metric', reminderTime: '07:00' });
      case '/users/me/identities': return send({ providers: ['whoop'], whoopEnabled: true });
      case '/users/me/whoop/profile': return send({ name: user.displayName, connected: true, shareUrl: null });
      case '/users/me/whoop/sync': return send({ connected: true, lastSync: new Date().toISOString(), jobs: [] });
      case '/users/me/whoop/workouts': return send({ workouts: [] });
      case '/users/me/whoop/dashboard': dashboardReads++; return send(sample(url.searchParams.get('start')!, url.searchParams.get('end')!));
      case '/users/me/logs': {
        if (request.method() === 'GET') return send({ logs: [...logs.values()], nextCursor: null });
        const mutation = request.postDataJSON() as HealthMutation;
        const current = logs.get(mutation.id);
        if ((current?.version ?? 0) !== mutation.expectedVersion) return send({ error: { message: 'Changed on another device' } }, 409);
        const row = { id: mutation.id, version: mutation.expectedVersion + 1, entry: mutation.entry,
          createdAt: current?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() };
        logs.set(row.id, row); return send(row);
      }
      default: return send({ error: 'Unexpected test request: ' + url.pathname }, 404);
    }
  });
  return { logs, errors, dashboardReads: () => dashboardReads,
    async switchAccount() {
      activeUser = { ...user, id: '00000000-0000-4000-8000-000000000002', displayName: 'Second Athlete' };
      await page.evaluate((next) => {
        localStorage.setItem('@3plates/session-token', 'second-session');
        localStorage.setItem('@3plates/cache/me', JSON.stringify({ value: next, updatedAt: new Date().toISOString() }));
        window.dispatchEvent(new StorageEvent('storage', { key: '@3plates/session-token' }));
      }, activeUser);
    }, setOffline: (value: boolean) => { offline = value; } };
}

test('sign-in offers Google, Apple, and WHOOP', async ({ page }) => {
  const f = await setup(page, false); await page.goto('/sign-in');
  for (const provider of ['Google', 'Apple', 'WHOOP']) await expect(page.getByRole('button', { name: `Continue with ${provider}` })).toBeVisible();
  expect(f.errors).toEqual([]);
});

test('offline hydration survives reload, syncs, edits, and deletes', async ({ page }, info) => {
  const f = await setup(page); await page.goto('/log');
  await expect(page.getByRole('button', { name: 'Save entry', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'hydration', exact: true }).click();
  await page.getByLabel('Water (mL)').fill('400');
  f.setOffline(true); await page.getByRole('button', { name: 'Save entry', exact: true }).click();
  await expect(page.getByText('400 mL', { exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByText('400 mL', { exact: true })).toBeVisible();
  expect(f.logs.size).toBe(0);
  f.setOffline(false); await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect.poll(() => f.logs.size).toBe(1);
  await page.getByRole('button', { name: 'Edit hydration entry' }).click();
  await page.getByLabel('Water (mL)').fill('600'); await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('600 mL', { exact: true })).toBeVisible();
  await expect.poll(() => [...f.logs.values()][0].version).toBe(2);
  await page.screenshot({ path: `test-results/log-${info.project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Delete entry', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete entry', exact: true }).click();
  await expect.poll(() => [...f.logs.values()][0].entry).toBe(null);
  expect(f.errors).toEqual([]);
});

test('unified navigation renders WHOOP charts, account controls, and structured workout input', async ({ page }, info) => {
  const f = await setup(page); await page.goto('/today');
  await expect(page.getByRole('heading', { name: /Today, Synthetic/ })).toBeVisible();
  await expect.poll(f.dashboardReads).toBe(1);
  await page.getByRole('button', { name: 'Refresh and sync', exact: true }).click();
  await expect.poll(f.dashboardReads).toBe(2);
  await page.getByRole('link', { name: 'Trends', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'WHOOP overview', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Lifetime', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/trends-${info.project.name}.png`, fullPage: true });
  await page.getByRole('link', { name: 'Account', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove WHOOP', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Link Google', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Delete my account', exact: true })).toBeDisabled();
  await page.getByRole('link', { name: 'Log', exact: true }).click();
  await page.getByLabel('Workout title').fill('Strength day');
  await page.getByLabel('Duration (minutes)').fill('45');
  await page.getByRole('button', { name: 'Add exercise', exact: true }).click();
  await page.getByLabel('Exercise 1 name').fill('Squat');
  await page.getByLabel('Exercise 1, set 1: reps').fill('5');
  await page.getByLabel('Exercise 1, set 1: weight (kg)').fill('100');
  await page.getByRole('button', { name: 'Save entry', exact: true }).click();
  await expect.poll(() => f.logs.size).toBe(1);
  const entry = [...f.logs.values()][0].entry;
  expect(entry?.kind).toBe('workout');
  if (entry?.kind === 'workout') expect(entry.details.exercises[0].sets[0]).toEqual({ reps: 5, weightKg: 100 });
  await page.getByRole('link', { name: 'Workouts', exact: true }).click();
  await expect(page.getByText(/Strength day/)).toBeVisible();
  expect(f.errors).toEqual([]);
});

test('nutrition, sleep, recovery, weight, and goals save through the actual forms', async ({ page }) => {
  const f = await setup(page); await page.goto('/log');
  await expect(page.getByRole('button', { name: 'Save entry', exact: true })).toBeEnabled();
  const save = async (kind: string) => {
    await page.getByRole('button', { name: 'Save entry', exact: true }).click();
    await expect.poll(() => [...f.logs.values()].some((log) => log.entry?.kind === kind)).toBe(true);
  };
  await page.getByRole('button', { name: 'nutrition', exact: true }).click();
  for (const [label, value] of [['Meal or food', 'Lunch'], ['Calories (kcal)', '600'], ['Protein (g)', '40'], ['Carbohydrates (g)', '70'], ['Fat (g)', '18']]) await page.getByLabel(label, { exact: true }).fill(value);
  await save('nutrition');
  await page.getByRole('button', { name: 'sleep', exact: true }).click(); await save('sleep');
  await page.getByRole('button', { name: 'recovery', exact: true }).click();
  await page.getByLabel('Tags (comma separated)').fill('travel, rested'); await save('recovery');
  await page.getByRole('button', { name: 'weight', exact: true }).click();
  await page.getByLabel('Body weight (kg)').fill('80'); await save('weight');
  await page.getByRole('button', { name: 'goal', exact: true }).click();
  await page.getByLabel('Target in the selected units').fill('4'); await save('goal');
  expect(f.logs.size).toBe(5); expect(f.errors).toEqual([]);
});


test('an open form cannot overwrite an edit that arrives from another device', async ({ page }) => {
  const f = await setup(page); await page.goto('/log');
  await expect(page.getByRole('button', { name: 'Save entry', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'hydration', exact: true }).click();
  await page.getByLabel('Water (mL)').fill('250');
  await page.getByRole('button', { name: 'Save entry', exact: true }).click();
  await expect.poll(() => f.logs.size).toBe(1);
  await page.getByRole('button', { name: 'Edit hydration entry' }).click();
  await page.getByLabel('Water (mL)').fill('400');
  const saved = [...f.logs.values()][0];
  if (saved.entry?.kind !== 'hydration') throw new Error('Missing hydration fixture');
  f.logs.set(saved.id, { ...saved, version: 2, entry: { ...saved.entry, details: { milliliters: 900 } } });
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect(page.getByText('900 mL', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText(/changed while you were editing/)).toBeVisible();
  await expect(page.getByLabel('Water (mL)')).toHaveValue('400');
  expect(f.logs.get(saved.id)?.version).toBe(2); expect(f.errors).toEqual([]);
});

test("switching accounts clears the previous account\'s open form", async ({ page }) => {
  const f = await setup(page); await page.goto('/log');
  await page.getByLabel('Workout title').fill('Private unsaved workout');
  await f.switchAccount();
  await expect(page.getByLabel('Workout title')).toHaveValue('');
  expect(f.errors).toEqual([]);
});
