import { createHash } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { sample } from '../../whoop/web/demo';
import type { HealthLog, HealthMutation, Preferences } from '@3plates/contract';
const user = { id: '00000000-0000-4000-8000-000000000001', email: 'synthetic@example.test', displayName: 'Synthetic Athlete' };
async function setup(page: Page, signedIn = true) {
  let offline = false;
  let whoopUnavailable = false;
  let apiUnavailable = false;
  let dashboardReads = 0;
  let deletions = 0;
  let activeUser = user;
  const preferences = new Map<string, Preferences>();
  const logs = new Map<string, HealthLog>();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  if (signedIn) await page.addInitScript(({ user, sessionHash }) => {
    localStorage.setItem('@3plates/session-token', 'synthetic-session');
    localStorage.setItem('@3plates/cache/me', JSON.stringify({ value: user, updatedAt: new Date().toISOString(), sessionHash }));
  }, { user, sessionHash: createHash('sha256').update('synthetic-session').digest('hex') });
  await page.route('**/*', async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin === 'http://127.0.0.1:4173') return route.continue();
    if (offline) return route.abort('failed');
    const send = (json: unknown, status = 200) => route.fulfill({ status, json, headers: { 'access-control-allow-origin': '*' } });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (apiUnavailable) return send({ error: 'API unavailable' }, 502);
    if (whoopUnavailable && url.pathname.startsWith('/users/me/whoop/')) return send({ error: 'WHOOP is unavailable' }, 503);
    switch (url.pathname) {
      case '/auth/providers': return send({ providers: ['google', 'apple', 'whoop'] });
      case '/users/me': if (request.method() === 'DELETE') { deletions++; return send({ deletionRequested: true }, 202); } return send(activeUser);
      case '/users/me/preferences': {
        if (request.method() === 'PUT') preferences.set(activeUser.id, request.postDataJSON());
        return send(preferences.get(activeUser.id) ?? { theme: 'system', units: 'metric', reminderTime: '07:00' });
      }
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
  return { logs, errors, preferences, deletions: () => deletions, setApiUnavailable: (value: boolean) => { apiUnavailable = value; }, setWhoopUnavailable: (value: boolean) => { whoopUnavailable = value; }, dashboardReads: () => dashboardReads,
    async switchAccount(preserveCachedOwner = false) {
      activeUser = { ...user, id: '00000000-0000-4000-8000-000000000002', displayName: 'Second Athlete' };
      await page.evaluate(({ next, preserveCachedOwner, sessionHash }) => {
        localStorage.setItem('@3plates/session-token', 'second-session');
        if (!preserveCachedOwner) localStorage.setItem('@3plates/cache/me', JSON.stringify({ value: next, updatedAt: new Date().toISOString(), sessionHash }));
        window.dispatchEvent(new StorageEvent('storage', { key: '@3plates/session-token' }));
      }, { next: activeUser, preserveCachedOwner, sessionHash: createHash('sha256').update('second-session').digest('hex') });
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
  await expect(page.getByText(/^\d{4}-\d{2}-\d{2}: Strength day - 45 min$/)).toBeVisible();
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


test('WHOOP outages leave reconnect, manual export, deletion, and sign-out controls available', async ({ page }) => {
  const f = await setup(page); f.setWhoopUnavailable(true); await page.goto('/account');
  await expect(page.getByText(/WHOOP is temporarily unavailable/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reconnect WHOOP', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Export manual data (JSON)', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeEnabled();
  await page.getByLabel('Type DELETE to confirm account deletion').fill('DELETE');
  await expect(page.getByRole('button', { name: 'Delete my account', exact: true })).toBeEnabled();
  f.setWhoopUnavailable(false); await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sync recent history', exact: true })).toBeEnabled();
  expect(f.errors).toEqual([]);
});

test('loading the same workout history dates retries WHOOP', async ({ page }) => {
  const f = await setup(page); await page.goto('/training');
  await expect.poll(f.dashboardReads).toBe(1);
  await page.getByRole('button', { name: 'Load history', exact: true }).click();
  await expect.poll(f.dashboardReads).toBe(2);
  expect(f.errors).toEqual([]);
});


test('API 502 responses still allow offline manual entries and cached accounts can sign out', async ({ page }) => {
  const f = await setup(page); await page.goto('/log');
  await expect(page.getByRole('button', { name: 'Save entry', exact: true })).toBeEnabled();
  f.setApiUnavailable(true); await page.reload();
  await page.getByRole('button', { name: 'hydration', exact: true }).click();
  await page.getByLabel('Water (mL)').fill('350');
  await page.getByRole('button', { name: 'Save entry', exact: true }).click();
  await expect(page.getByText('350 mL', { exact: true })).toBeVisible();
  expect(f.logs.size).toBe(0);
  f.setApiUnavailable(false); await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect.poll(() => f.logs.size).toBe(1);
  f.setApiUnavailable(true); await page.getByRole('link', { name: 'Account', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  expect(await page.evaluate(() => localStorage.getItem('@3plates/session-token'))).toBeNull();
  expect(f.errors).toEqual([]);
});

test('delayed imperial preferences cannot change the units of an open edit', async ({ page }) => {
  const f = await setup(page);
  const id = '00000000-0000-4000-8000-000000000099';
  f.logs.set(id, { id, version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    entry: { kind: 'weight', date: '2026-11-14', timezone: 'UTC', notes: '', details: { kilograms: 100 } } });
  let release!: () => void;
  const preferencesReady = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/users/me/preferences', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    await preferencesReady;
    await route.fulfill({ json: { theme: 'system', units: 'imperial', reminderTime: '07:00' }, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.goto('/log');
  await expect(page.getByText('Loading your measurement units...')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit weight entry' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save entry', exact: true })).toHaveCount(0);
  release();
  await page.getByRole('button', { name: 'Edit weight entry' }).click();
  await expect(page.getByLabel('Body weight (lb)')).toHaveValue('220.4623');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect.poll(() => f.logs.get(id)?.version).toBe(2);
  const entry = f.logs.get(id)?.entry;
  expect(entry?.kind === 'weight' && entry.details.kilograms).toBeCloseTo(100, 3);
  expect(f.errors).toEqual([]);
});

test('account outages retain pending edits until confirmed discard and sign-out', async ({ page }) => {
  const f = await setup(page); await page.goto('/log');
  await page.getByRole('button', { name: 'hydration', exact: true }).click();
  await page.getByLabel('Water (mL)').fill('350');
  f.setApiUnavailable(true);
  await page.getByRole('button', { name: 'Save entry', exact: true }).click();
  await expect(page.getByText('350 mL', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Account', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Discard pending edits and sign out', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('@3plates/session-token'))).toBe('synthetic-session');
  await page.getByRole('button', { name: 'Confirm discard and sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  expect(await page.evaluate(() => localStorage.getItem('@3plates/session-token'))).toBeNull();
  expect(f.logs.size).toBe(0); expect(f.errors).toEqual([]);
});

test('appearance follows system changes and explicit choices persist across routes and reloads', async ({ page }, info) => {
  const f = await setup(page); await page.emulateMedia({ colorScheme: 'dark' }); await page.goto('/today');
  const surface = () => page.locator('[data-testid="fitness-page"]:visible');
  await expect(surface()).toHaveCSS('background-color', 'rgb(14, 23, 31)');
  await expect(page.getByRole('radio', { name: 'Theme: Follow system', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(surface()).toHaveCSS('background-color', 'rgb(244, 247, 249)');
  await page.getByRole('radio', { name: 'Theme: Dark', exact: true }).click();
  await expect(surface()).toHaveCSS('background-color', 'rgb(14, 23, 31)');
  await page.getByRole('link', { name: 'Log', exact: true }).click();
  await expect(page.getByLabel('Workout title')).toHaveCSS('background-color', 'rgb(23, 38, 47)');
  await expect(page.getByLabel('Workout title')).toHaveCSS('color', 'rgb(237, 245, 248)');
  await page.reload(); await expect(page.getByRole('radio', { name: 'Theme: Dark', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('link', { name: 'Trends', exact: true }).click();
  await expect(page.locator('svg:visible text').first()).toHaveAttribute('fill', '#b2c4ce');
  await page.screenshot({ path: `test-results/theme-dark-${info.project.name}.png`, fullPage: true });
  await page.getByRole('radio', { name: 'Theme: Light', exact: true }).click();
  await expect(surface()).toHaveCSS('background-color', 'rgb(244, 247, 249)');
  await page.screenshot({ path: `test-results/theme-light-${info.project.name}.png`, fullPage: true });
  await page.getByRole('radio', { name: 'Theme: Follow system', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(surface()).toHaveCSS('background-color', 'rgb(14, 23, 31)');
  expect(f.errors).toEqual([]);
});

test('offline appearance survives restart, synchronizes, and stays scoped to its account', async ({ page }) => {
  await page.clock.install();
  const f = await setup(page); await page.emulateMedia({ colorScheme: 'light' }); await page.goto('/today');
  await expect(page.getByRole('radio', { name: 'Theme: Dark', exact: true })).toBeEnabled();
  f.setApiUnavailable(true);
  await page.getByRole('radio', { name: 'Theme: Dark', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Theme: Dark', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Theme: Dark', exact: true })).toHaveAttribute('aria-checked', 'true');
  f.setApiUnavailable(false); await page.clock.fastForward(31000);
  await expect.poll(() => f.preferences.get(user.id)?.theme).toBe('dark');
  await expect(page.getByRole('radio', { name: 'Theme: Dark', exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Theme: Dark', exact: true })).toHaveAttribute('aria-checked', 'true');
  await f.switchAccount();
  await expect(page.getByRole('radio', { name: 'Theme: Follow system', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-testid="fitness-page"]:visible')).toHaveCSS('background-color', 'rgb(244, 247, 249)');
  expect(f.errors).toEqual([]);
});

test('saved Settings theme updates the fitness screens and preserves other preferences', async ({ page }) => {
  const f = await setup(page); await page.goto('/preferences');
  await expect(page.getByRole('button', { name: 'Save preferences', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'dark', exact: true }).click();
  await page.getByRole('button', { name: 'imperial', exact: true }).click();
  await page.getByLabel('Reminder time').fill('08:30');
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.getByText('Preferences saved to backend.')).toBeVisible();
  await expect(page.getByLabel('Reminder time')).toHaveCSS('background-color', 'rgb(23, 38, 47)');
  await page.goto('/log');
  await expect(page.getByRole('radio', { name: 'Theme: Dark', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: 'Theme: Light', exact: true }).click();
  await page.goto('/preferences');
  await expect(page.getByRole('button', { name: 'imperial', exact: true })).toHaveCSS('background-color', 'rgb(20, 43, 56)');
  await expect(page.getByLabel('Reminder time')).toHaveValue('08:30');
  expect(f.errors).toEqual([]);
});


test('cached dark appearance is usable before an unreachable API responds', async ({ page }) => {
  const f = await setup(page); await page.emulateMedia({ colorScheme: 'light' }); await page.goto('/today');
  await page.getByRole('radio', { name: 'Theme: Dark', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Theme: Dark', exact: true })).toHaveAttribute('aria-checked', 'true');
  let release!: () => void;
  const stalled = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/users/me', async (route) => { await stalled; await route.abort('failed'); });
  try {
    await page.reload();
    await expect(page.locator('[data-testid="fitness-page"]:visible')).toHaveCSS('background-color', 'rgb(14, 23, 31)', { timeout: 1500 });
    await expect(page.getByRole('radio', { name: 'Theme: Light', exact: true })).toBeEnabled({ timeout: 1500 });
  } finally { release(); }
  expect(f.errors).toEqual([]);
});

test('reconnect during an account switch cannot hydrate or edit the previous owner preferences', async ({ page }) => {
  const f = await setup(page); await page.emulateMedia({ colorScheme: 'light' });
  f.preferences.set(user.id, { theme: 'dark', units: 'imperial', reminderTime: '08:30' });
  await page.goto('/today');
  await expect(page.getByRole('radio', { name: 'Theme: Dark', exact: true })).toHaveAttribute('aria-checked', 'true');
  let release!: () => void; let requests = 0;
  const stalled = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/users/me', async (route) => { requests++; await stalled; await route.fallback(); });
  try {
    await f.switchAccount(true);
    await expect.poll(() => requests).toBeGreaterThanOrEqual(2);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(() => requests).toBeGreaterThanOrEqual(3);
    await expect(page.getByRole('radio', { name: 'Theme: Dark', exact: true })).toBeDisabled();
    await expect(page.getByRole('radio', { name: 'Theme: Follow system', exact: true })).toHaveAttribute('aria-checked', 'true');
  } finally { release(); }
  await expect(page.getByRole('radio', { name: 'Theme: Dark', exact: true })).toBeEnabled();
  await page.getByRole('radio', { name: 'Theme: Dark', exact: true }).click();
  await expect.poll(() => f.preferences.get('00000000-0000-4000-8000-000000000002')).toEqual({ theme: 'dark', units: 'metric', reminderTime: '07:00' });
  expect(f.errors).toEqual([]);
});

test('account deletion confirmation cannot carry into a switched account', async ({ page }) => {
  const f = await setup(page); await page.goto('/account');
  await page.getByLabel('Type DELETE to confirm account deletion').fill('DELETE');
  await page.getByRole('button', { name: 'Delete my account', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm permanent account deletion', exact: true })).toBeEnabled();
  await f.switchAccount();
  await expect(page.getByText(/Second Athlete/)).toBeVisible();
  await expect(page.getByLabel('Type DELETE to confirm account deletion')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Delete my account', exact: true })).toBeDisabled();
  await page.getByLabel('Type DELETE to confirm account deletion').fill('DELETE');
  await page.getByRole('button', { name: 'Delete my account', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm permanent account deletion', exact: true })).toBeEnabled();
  expect(f.deletions()).toBe(0);
});

test('provider discovery can retry after connectivity returns', async ({ page }) => {
  const f = await setup(page, false); f.setApiUnavailable(true); await page.goto('/sign-in');
  await expect(page.getByText(/Cannot reach the sign-in server/)).toBeVisible();
  f.setApiUnavailable(false);
  await page.getByRole('button', { name: 'Retry sign-in options', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue with WHOOP', exact: true })).toBeVisible();
});

test('weight chart preserves calendar spacing and gaps', async ({ page }) => {
  const f = await setup(page);
  for (const [day, kilograms] of [[1, 80], [2, 79], [30, 78]]) {
    const id = `00000000-0000-4000-8000-${String(day).padStart(12, "0")}`;
    f.logs.set(id, { id, version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      entry: { kind: 'weight', date: `2026-01-${String(day).padStart(2, '0')}`, timezone: 'UTC', notes: '', details: { kilograms } } });
  }
  await page.goto('/trends');
  await page.getByLabel('Start (YYYY-MM-DD)').fill('2026-01-01');
  await page.getByLabel('End (YYYY-MM-DD)').fill('2026-01-30');
  await page.getByRole('button', { name: 'Apply dates and refresh', exact: true }).click();
  const chart = page.getByLabel(/Body weight \(kg\)\. 3 observations/);
  await expect(chart.locator('circle')).toHaveCount(3);
  const xs = await chart.locator('circle').evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute('cx'))));
  expect((xs[2] - xs[1]) / (xs[1] - xs[0])).toBeCloseTo(28);
  await expect(chart.locator('polyline')).toHaveCount(2);
});
