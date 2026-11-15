import { clearLogDraft } from './log-draft';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { apiBaseUrl, fetchMe, getCachedUser, getSessionGeneration, getSessionToken, registerSignOutCleanup } from './api';
import { createHealthSync, SyncFailure, type HealthSync } from './health-sync';
import { fetchFitnessText } from './fitness-http';
import type { Dashboard } from '@3plates/whoop/types';

const engines = new Map<string, HealthSync>();
let checkedToken: string | null = null;
let checkedOwner: Promise<string> | null = null;
export async function fitnessRequest<T>(path: string, method = 'GET', body?: unknown, expectedOwner?: string): Promise<T> {
  const token = await getSessionToken();
  if (!token) throw new SyncFailure(401, 'Sign in to continue.');
  if (expectedOwner) {
    if ((await getCachedUser())?.id !== expectedOwner) throw new SyncFailure(401, 'Your active account changed.');
    if (checkedToken !== token || !checkedOwner) {
      checkedToken = token;
      checkedOwner = fetchFitnessText(apiBaseUrl + '/users/me', token, 'GET').then((text) => JSON.parse(text).id as string);
    }
    let actual: string;
    try { actual = await checkedOwner; } catch (error) { checkedOwner = null; throw error; }
    if (actual !== expectedOwner) throw new SyncFailure(401, 'Queued entries belong to a different account.');
  }
  const result = JSON.parse(await fetchFitnessText(apiBaseUrl + path, token, method, body)) as T;
  if (await getSessionToken() !== token || (expectedOwner && (await getCachedUser())?.id !== expectedOwner)) {
    throw new SyncFailure(401, 'Your active account changed.');
  }
  return result;
}
export async function currentFitnessAccount() {
  const { data: user } = await fetchMe();
  let engine = engines.get(user.id);
  if (!engine) {
    const locks = (globalThis as unknown as { navigator?: { locks?: { request<T>(key: string, run: () => Promise<T>): Promise<T> } } }).navigator?.locks;
    engine = createHealthSync({ userId: user.id, storage: AsyncStorage, uuid: randomUUID,
      request: (path, mutation) => fitnessRequest(path, mutation ? 'POST' : 'GET', mutation, user.id),
      lock: locks ? (key, run) => locks.request(key, run) : undefined,
    });
    engines.set(user.id, engine);
  }
  return { user, engine };
}
const whoopKey = (id: string) => `@3plates/whoop/${id}`;
export async function loadWhoopDashboard(userId: string, start: string, end: string) {
  const key = whoopKey(userId);
  try {
    const data = await fitnessRequest<Dashboard>(`/users/me/whoop/dashboard?${new URLSearchParams({ start, end })}`, 'GET', undefined, userId);
    const result = { data, start, end, savedAt: new Date().toISOString() };
    await AsyncStorage.setItem(key, JSON.stringify(result));
    return { ...result, stale: false };
  } catch (error) {
    if (error instanceof SyncFailure && error.status < 500 && error.status !== 429) throw error;
    const saved = await AsyncStorage.getItem(key);
    if (!saved) throw error;
    const result = JSON.parse(saved) as { data: Dashboard; start: string; end: string; savedAt: string };
    if (result.start !== start || result.end !== end) throw error;
    return { ...result, stale: true };
  }
}
export async function clearFitnessCache(userId: string, discardPending = false) {
  const engine = engines.get(userId) ?? createHealthSync({ userId, storage: AsyncStorage, uuid: randomUUID, request: async () => { throw new Error('Offline'); } });
  await engine.clear(discardPending);
  clearLogDraft(userId);
  await AsyncStorage.removeItem(whoopKey(userId));
  engines.delete(userId); checkedToken = null; checkedOwner = null;
}
export async function clearWhoopCache(userId: string) { await AsyncStorage.removeItem(whoopKey(userId)); }
registerSignOutCleanup(async (user) => {
  if (user) await clearFitnessCache(user.id);
});

export async function exportFitnessFile(path: string, filename: string, mimeType: string, owner: string | undefined) {
  const generation = getSessionGeneration();
  const token = await getSessionToken();
  if (!token) throw new SyncFailure(401, 'Sign in to export your data.');
  async function assertOwner() {
    if (!owner || generation !== getSessionGeneration() || await getSessionToken() !== token || (await getCachedUser())?.id !== owner || generation !== getSessionGeneration())
      throw new SyncFailure(401, 'Your active account changed. Export cancelled.');
  }
  await assertOwner();
  const text = await fetchFitnessText(apiBaseUrl + path, token, 'GET');
  const { Platform } = await import('react-native');
  await assertOwner();
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename;
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } else {
    const { File, Paths } = await import('expo-file-system');
    const { shareAsync, isAvailableAsync } = await import('expo-sharing');
    if (!await isAvailableAsync()) throw new Error('File sharing is unavailable on this device.');
    await assertOwner();
    const file = new File(Paths.cache, randomUUID() + '-' + filename);
    try { await file.write(text); await assertOwner(); await shareAsync(file.uri, { mimeType, dialogTitle: 'Export your fitness data' }); }
    finally { if (file.exists) await file.delete(); }
  }
}
