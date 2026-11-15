import { initClient } from '@ts-rest/core';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { appContract } from '@3plates/contract';
import type {
  AuthProvider,
  ManualWorkout,
  ManualWorkoutCreate,
  ManualWorkoutListResponse,
  NotificationDevice,
  Preferences,
  Progress,
  WorkoutListOrder,
  WorkoutListResponse,
  WorkoutMode,
  User,
} from '@3plates/contract';

export const productionApiUrl = 'https://api.3spinningplates.com';

export function resolveApiBaseUrl(apiUrl = process.env.EXPO_PUBLIC_API_URL) {
  const normalizedApiUrl = apiUrl?.trim();

  return normalizedApiUrl || productionApiUrl;
}

export const apiBaseUrl = resolveApiBaseUrl();

export const apiClient = initClient(appContract, {
  baseUrl: apiBaseUrl,
});

type StorageLike = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

type ContractClientLike = Pick<
  typeof apiClient,
  'authStart'
  | 'authLinkStart'
  | 'authCallback'
  | 'authExchange'
  | 'authRefresh'
  | 'authSignOut'
  | 'me'
  | 'progress'
  | 'updateProgress'
  | 'manualWorkouts'
  | 'createManualWorkout'
  | 'deleteManualWorkout'
  | 'preferences'
  | 'updatePreferences'
  | 'registerDevice'
  | 'workoutsByMode'
>;

const defaultStorage: StorageLike = AsyncStorage;

let storage: StorageLike = defaultStorage;
let contractClient: ContractClientLike = apiClient;

const storageKeys = {
  sessionToken: '@3plates/session-token',
  me: '@3plates/cache/me',
  progress: '@3plates/cache/progress',
  manualWorkouts: '@3plates/cache/manual-workouts',
  preferences: '@3plates/cache/preferences',
  workoutsPrefix: '@3plates/cache/workouts/',
  pendingMutations: '@3plates/pending-mutations',
} as const;

let secureStoreAvailabilityPromise: Promise<boolean> | null = null;
let secureStoreModulePromise: Promise<null | {
  isAvailableAsync: () => Promise<boolean>;
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
}> | null = null;

async function loadSecureStoreModule() {
  if (!secureStoreModulePromise) {
    secureStoreModulePromise = import('expo-secure-store')
      .then((module) => ({
        isAvailableAsync: module.isAvailableAsync,
        getItemAsync: module.getItemAsync,
        setItemAsync: module.setItemAsync,
        deleteItemAsync: module.deleteItemAsync,
      }))
      .catch(() => null);
  }

  return secureStoreModulePromise;
}

async function isSecureStoreAvailable() {
  if (!secureStoreAvailabilityPromise) {
    secureStoreAvailabilityPromise = loadSecureStoreModule()
      .then(async (module) => {
        if (!module) {
          return false;
        }

        return module.isAvailableAsync();
      })
      .catch(() => false);
  }

  return secureStoreAvailabilityPromise;
}

async function readSessionToken() {
  const secureStore = await loadSecureStoreModule();
  const secureStoreAvailable = await isSecureStoreAvailable();
  if (secureStoreAvailable && secureStore) {
    return secureStore.getItemAsync(storageKeys.sessionToken);
  }

  return storage.getItem(storageKeys.sessionToken);
}

async function writeSessionToken(token: string | null) {
  const secureStore = await loadSecureStoreModule();
  const secureStoreAvailable = await isSecureStoreAvailable();
  if (secureStoreAvailable && secureStore) {
    if (!token) {
      await secureStore.deleteItemAsync(storageKeys.sessionToken);
      return;
    }

    await secureStore.setItemAsync(storageKeys.sessionToken, token);
    return;
  }

  if (!token) {
    await storage.removeItem(storageKeys.sessionToken);
    return;
  }

  await storage.setItem(storageKeys.sessionToken, token);
}

type CacheEnvelope<T> = {
  value: T;
  updatedAt: string;
  sessionHash?: string;
};

type PendingMutation =
  | {
      id: string;
      type: 'updateProgress';
      createdAt: string;
      payload: Progress;
    }
  | {
      id: string;
      type: 'updatePreferences';
      createdAt: string;
      payload: Preferences;
    }
  | {
      id: string;
      type: 'registerDevice';
      createdAt: string;
      payload: NotificationDevice;
    };

type ApiErrorBody = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
};

type FetchWorkoutsOptions = {
  page?: number;
  pageSize?: number;
  order?: WorkoutListOrder;
};

export class ApiRequestError extends Error {
  status: number;
  code: string | null;

  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

export type CachedReadResult<T> = {
  data: T;
  source: 'network' | 'cache';
};

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const maybeError = value as { ok?: unknown; error?: { code?: unknown; message?: unknown } };
  return (
    maybeError.ok === false
    && typeof maybeError.error?.code === 'string'
    && typeof maybeError.error?.message === 'string'
  );
}

async function assertCurrentSession(token: string) {
  if (await getSessionToken() !== token) throw new ApiRequestError(401, 'Your active account changed.', 'invalid_auth');
}

async function sessionHash(token: string) {
  // Bind cached identity without copying the native secure-store credential into AsyncStorage.
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  const crypto = await import('expo-crypto');
  return crypto.digestStringAsync(crypto.CryptoDigestAlgorithm.SHA256, token);
}

async function migratePreviousProfile() {
  const raw = await storage.getItem(storageKeys.me);
  if (!raw) return;
  let previous: User | null = null;
  try { previous = JSON.parse(raw)?.value ?? null; } catch { /* Invalid profile is a recoverable cache miss. */ }
  if (typeof previous?.id === 'string' && previous.id) {
    await migrateLegacyCache(previous.id);
  } else {
    // Preserve orphaned offline data without assigning it to a newly signed-in user.
    migratedUsers.delete('unverified');
    await migrateLegacyCache('unverified');
  }
}

async function writeCache<T>(key: string, value: T, token?: string) {
  if (token) await assertCurrentSession(token);
  if (key === storageKeys.me) {
    await migratePreviousProfile();
  }
  const destination = await accountStorageKey(key);
  if (token) await assertCurrentSession(token);
  const envelope: CacheEnvelope<T> = {
    value,
    updatedAt: new Date().toISOString(),
    ...(key === storageKeys.me && token ? { sessionHash: await sessionHash(token) } : {}),
  };

  await storage.setItem(destination, JSON.stringify(envelope));
}

async function accountStorageKey(key: string) {
  if (key === storageKeys.me || key.startsWith(storageKeys.workoutsPrefix)) return key;
  const user = await readCache<User>(storageKeys.me);
  if (!user && await storage.getItem(storageKeys.me)) throw new ApiRequestError(401, 'Verify your active account before using cached data.', 'invalid_auth');
  if (user) await migrateLegacyCache(user.id);
  return user ? `${key}/user/${user.id}` : key;
}

let migration: Promise<unknown> = Promise.resolve();
const migratedUsers = new Set<string>();
function migrateLegacyCache(userId: string) {
  const run = migration.catch(() => undefined).then(async () => {
    if (migratedUsers.has(userId)) return;
    for (const key of [storageKeys.progress, storageKeys.manualWorkouts, storageKeys.preferences, storageKeys.pendingMutations]) {
      const legacy = await storage.getItem(key);
      if (!legacy) continue;
      const destination = `${key}/user/${userId}`;
      const existing = await storage.getItem(destination);
      let value = existing ?? legacy;
      if (key === storageKeys.pendingMutations && existing) {
        const oldQueue = JSON.parse(legacy) as PendingMutation[];
        const newQueue = JSON.parse(existing) as PendingMutation[];
        if (!Array.isArray(oldQueue) || !Array.isArray(newQueue)) throw new Error('Offline changes need storage recovery. They have not been discarded.');
        value = JSON.stringify([...oldQueue.filter((item) => !newQueue.some((other) => other.id === item.id)), ...newQueue]);
      }
      // Copy before removal. An interrupted migration can safely repeat; receipt
      // IDs in a pending queue are retained, including across account switches.
      await storage.setItem(destination, value);
      await storage.removeItem(key);
    }
    migratedUsers.add(userId);
  });
  migration = run;
  return run;
}

async function readCache<T>(key: string): Promise<T | null> {
  const rawValue = await storage.getItem(await accountStorageKey(key));
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as CacheEnvelope<T>;
    if (!parsed || typeof parsed !== 'object' || !('value' in parsed)) {
      return null;
    }

    if (key === storageKeys.me) {
      const token = await getSessionToken();
      if (!token || parsed.sessionHash !== await sessionHash(token)) return null;
      await assertCurrentSession(token);
    }
    return parsed.value;
  } catch {
    return null;
  }
}

function buildAuthHeaders(token: string | null) {
  if (!token) {
    return undefined;
  }

  return {
    authorization: `Bearer ${token}`,
  };
}

async function requireSessionToken() {
  const token = await getSessionToken();
  if (!token) {
    throw new ApiRequestError(401, 'No session token is available.', 'invalid_auth');
  }

  return token;
}

function toApiRequestError(status: number, body: unknown) {
  if (isApiErrorBody(body)) {
    return new ApiRequestError(status, body.error.message, body.error.code);
  }

  return new ApiRequestError(status, 'Unexpected API response.', null);
}

function isNetworkFailure(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes('network request failed') || message.includes('failed to fetch');
}

function makeMutationId() {
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readPendingMutations(key?: string): Promise<PendingMutation[]> {
  const rawValue = await storage.getItem(key ?? await accountStorageKey(storageKeys.pendingMutations));
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue) as PendingMutation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writePendingMutations(key: string, mutations: PendingMutation[]) {
  await storage.setItem(key, JSON.stringify(mutations));
}

function coalescePendingMutations(mutations: PendingMutation[]) {
  let latestProgressIndex = -1;
  for (let index = mutations.length - 1; index >= 0; index -= 1) {
    if (mutations[index]?.type === 'updateProgress') {
      latestProgressIndex = index;
      break;
    }
  }

  if (latestProgressIndex === -1) {
    return mutations;
  }

  return mutations.filter((mutation, index) => mutation.type !== 'updateProgress' || index === latestProgressIndex);
}

async function queuePendingMutation(mutation: PendingMutation, token: string) {
  await assertCurrentSession(token);
  const key = await accountStorageKey(storageKeys.pendingMutations);
  await assertCurrentSession(token);
  const existing = coalescePendingMutations(await readPendingMutations(key));
  const nextMutations = mutation.type === 'updateProgress' || mutation.type === 'updatePreferences'
    ? existing.filter((candidate) => candidate.type !== mutation.type)
    : existing;

  await assertCurrentSession(token);
  await writePendingMutations(key, [...nextMutations, mutation]);
}

async function removePendingMutationsByType(type: PendingMutation['type'], token: string) {
  await assertCurrentSession(token);
  const key = await accountStorageKey(storageKeys.pendingMutations);
  await assertCurrentSession(token);
  const existing = JSON.parse(await storage.getItem(key) ?? '[]') as PendingMutation[];
  await assertCurrentSession(token);
  await storage.setItem(key, JSON.stringify(existing.filter((mutation) => mutation.type !== type)));
}

async function executePendingMutation(mutation: PendingMutation, token: string) {
  const extraHeaders = buildAuthHeaders(token);

  if (mutation.type === 'updateProgress') {
    const response = await contractClient.updateProgress({
      extraHeaders,
      body: mutation.payload,
    });

    if (response.status !== 200) {
      throw toApiRequestError(response.status, response.body);
    }

    return;
  }

  if (mutation.type === 'updatePreferences') {
    const response = await contractClient.updatePreferences({
      extraHeaders,
      body: mutation.payload,
    });

    if (response.status !== 200) {
      throw toApiRequestError(response.status, response.body);
    }

    return;
  }

  const response = await contractClient.registerDevice({
    extraHeaders,
    body: mutation.payload,
  });

  if (response.status !== 200) {
    throw toApiRequestError(response.status, response.body);
  }
}

export async function getSessionToken() {
  return readSessionToken();
}

let sessionGeneration = 0;
const sessionListeners = new Set<() => void>();
const preferenceListeners = new Set<(preferences: Preferences) => void>();
let preferenceWriteRevision = 0;
let preferenceWork: Promise<unknown> = Promise.resolve();
function serializePreferences<T>(action: () => Promise<T>) {
  const next = preferenceWork.then(action, action);
  preferenceWork = next.catch(() => undefined);
  return next;
}
export function subscribePreferences(listener: (preferences: Preferences) => void) {
  preferenceListeners.add(listener);
  return () => { preferenceListeners.delete(listener); };
}
async function notifyPreferences(preferences: Preferences, token: string) {
  await assertCurrentSession(token);
  for (const listener of preferenceListeners) listener(preferences);
}
export const getSessionGeneration = () => sessionGeneration;
export function subscribeSession(listener: () => void) {
  sessionListeners.add(listener);
  return () => { sessionListeners.delete(listener); };
}
function sessionChanged() {
  sessionGeneration++;
  for (const listener of sessionListeners) listener();
}
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('storage', (event) => {
  if (event.key === storageKeys.sessionToken || event.key === null) sessionChanged();
});

// Serialize local session transitions so cleanup cannot erase a newer sign-in.
let sessionWork: Promise<unknown> = Promise.resolve();
function sessionTransition<T>(run: () => Promise<T>): Promise<T> {
  const next = sessionWork.then(run, run);
  sessionWork = next.catch(() => undefined);
  return next;
}
function assertSessionGeneration(expected: number) {
  if (getSessionGeneration() !== expected) throw new ApiRequestError(401, 'Your active account changed.', 'invalid_auth');
}
export function setSessionToken(token: string | null, expected?: { token: string; generation: number }) {
  return sessionTransition(async () => {
    if (expected) { assertSessionGeneration(expected.generation); await assertCurrentSession(expected.token); }
    await migratePreviousProfile();
    if (expected) { assertSessionGeneration(expected.generation); await assertCurrentSession(expected.token); }
    await writeSessionToken(token);
    sessionChanged();
  });
}

export function expireSession(expectedGeneration = getSessionGeneration()) {
  return sessionTransition(async () => {
    if (getSessionGeneration() !== expectedGeneration) return false;
    await migratePreviousProfile();
    if (getSessionGeneration() !== expectedGeneration) return false;
    await writeSessionToken(null);
    sessionChanged();
    return true;
  });
}

export function clearSession(expectedGeneration = getSessionGeneration()) {
  return sessionTransition(async () => {
    assertSessionGeneration(expectedGeneration);
    const owner = await getCachedUser();
    assertSessionGeneration(expectedGeneration);
    await writeSessionToken(null);
    sessionChanged();
    for (const key of [storageKeys.progress, storageKeys.manualWorkouts, storageKeys.preferences, storageKeys.pendingMutations]) {
      await storage.removeItem(owner ? `${key}/user/${owner.id}` : key);
    }
    await storage.removeItem(storageKeys.me);
    await storage.removeItem(storageKeys.progress);
    await storage.removeItem(storageKeys.manualWorkouts);
    await storage.removeItem(storageKeys.preferences);
    await storage.removeItem(storageKeys.pendingMutations);
  });
}

export async function startAuth(provider: AuthProvider, redirectTo?: string) {
  const response = await contractClient.authStart({
    body: {
      provider,
      ...(redirectTo ? { redirectTo } : {}),
    },
  });

  if (response.status !== 200) {
    throw toApiRequestError(response.status, response.body);
  }

  return response.body;
}

export async function startAuthLink(provider: AuthProvider, redirectTo?: string) {
  const token = await requireSessionToken();

  const response = await contractClient.authLinkStart({
    extraHeaders: buildAuthHeaders(token),
    body: {
      provider,
      ...(redirectTo ? { redirectTo } : {}),
    },
  });

  if (response.status !== 200) {
    throw toApiRequestError(response.status, response.body);
  }

  return response.body;
}

export async function completeAuthCallback(input: {
  provider: AuthProvider;
  code: string;
  state: string;
}) {
  const response = await contractClient.authCallback({
    query: {
      provider: input.provider,
      code: input.code,
      state: input.state,
    },
  });

  if (response.status !== 200) {
    throw toApiRequestError(response.status, response.body);
  }

  await setSessionToken(response.body.sessionToken);
  await writeCache(storageKeys.me, response.body.user, response.body.sessionToken);

  return response.body;
}

export async function refreshSessionAndPersist() {
  const generation = getSessionGeneration();
  const token = await requireSessionToken();

  const response = await contractClient.authRefresh({
    extraHeaders: buildAuthHeaders(token),
    body: {},
  });

  if (response.status !== 200) {
    throw toApiRequestError(response.status, response.body);
  }

  await setSessionToken(response.body.sessionToken, { token, generation });
  await writeCache(storageKeys.me, response.body.user, response.body.sessionToken);

  return response.body;
}

export async function redeemMobileAuthExchangeCode(code: string) {
  const response = await contractClient.authExchange({
    body: {
      code,
    },
  });

  if (response.status !== 200) {
    throw toApiRequestError(response.status, response.body);
  }

  await setSessionToken(response.body.sessionToken);
  await writeCache(storageKeys.me, response.body.user, response.body.sessionToken);

  return response.body;
}

let beforeSignOut: ((owner: User | null) => Promise<void>) | undefined;
export function registerSignOutCleanup(handler: (owner: User | null) => Promise<void>) { beforeSignOut = handler; }
export async function getCachedUser() { return readCache<User>(storageKeys.me); }
export async function getCachedPreferences() {
  const token = await requireSessionToken();
  const cached = await readCache<Preferences>(storageKeys.preferences);
  await assertCurrentSession(token);
  return cached;
}

export async function signOutAndClearSession(expectedGeneration = getSessionGeneration()) {
  assertSessionGeneration(expectedGeneration);
  const token = await getSessionToken();
  const owner = await getCachedUser();
  assertSessionGeneration(expectedGeneration);
  if (beforeSignOut) await beforeSignOut(owner);
  assertSessionGeneration(expectedGeneration);
  if (!token) {
    await clearSession(expectedGeneration);
    return {
      signedOut: false,
    };
  }

  try {
    const response = await contractClient.authSignOut({
      extraHeaders: buildAuthHeaders(token),
      body: {},
    });

    await clearSession(expectedGeneration);

    if (response.status === 200) {
      return {
        signedOut: true,
      };
    }

    if (response.status === 401) {
      return {
        signedOut: false,
      };
    }

    throw toApiRequestError(response.status, response.body);
  } catch (error) {
    if (isNetworkFailure(error)) {
      await clearSession(expectedGeneration);
      return {
        signedOut: false,
      };
    }

    throw error;
  }
}

export async function fetchMe(): Promise<CachedReadResult<User>> {
  const token = await requireSessionToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await contractClient.me({
      extraHeaders: buildAuthHeaders(token),
      fetchOptions: { signal: controller.signal },
    });

    if (response.status !== 200) {
      throw toApiRequestError(response.status, response.body);
    }

    await writeCache(storageKeys.me, response.body, token);

    return {
      data: response.body,
      source: 'network',
    };
  } catch (error) {
    const temporarilyUnavailable = error instanceof ApiRequestError && (error.status >= 500 || error.status === 429);
    if (!isNetworkFailure(error) && !controller.signal.aborted && !temporarilyUnavailable) {
      throw error;
    }

    await assertCurrentSession(token);
    const cached = await readCache<User>(storageKeys.me);
    if (!cached) {
      throw error;
    }

    return {
      data: cached,
      source: 'cache',
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchProgress(): Promise<CachedReadResult<Progress>> {
  const token = await requireSessionToken();

  try {
    const response = await contractClient.progress({
      extraHeaders: buildAuthHeaders(token),
    });

    if (response.status !== 200) {
      throw toApiRequestError(response.status, response.body);
    }

    await writeCache(storageKeys.progress, response.body, token);

    return {
      data: response.body,
      source: 'network',
    };
  } catch (error) {
    if (!isNetworkFailure(error)) {
      throw error;
    }

    const cached = await readCache<Progress>(storageKeys.progress);
    if (!cached) {
      throw error;
    }

    return {
      data: cached,
      source: 'cache',
    };
  }
}

export async function updateProgress(progress: Progress) {
  const token = await requireSessionToken();

  try {
    const response = await contractClient.updateProgress({
      extraHeaders: buildAuthHeaders(token),
      body: progress,
    });

    if (response.status !== 200) {
      throw toApiRequestError(response.status, response.body);
    }

    await removePendingMutationsByType('updateProgress', token);
    await writeCache(storageKeys.progress, progress, token);

    return {
      queued: false,
    };
  } catch (error) {
    if (!isNetworkFailure(error)) {
      throw error;
    }

    await queuePendingMutation({
      id: makeMutationId(),
      createdAt: new Date().toISOString(),
      type: 'updateProgress',
      payload: progress,
    }, token);
    await writeCache(storageKeys.progress, progress, token);

    return {
      queued: true,
    };
  }
}

async function updateCachedManualWorkouts(
  update: (current: ManualWorkoutListResponse) => ManualWorkoutListResponse,
  token: string,
) {
  const current = await readCache<ManualWorkoutListResponse>(storageKeys.manualWorkouts);
  if (!current) {
    return;
  }

  await writeCache(storageKeys.manualWorkouts, update(current), token);
}

export async function fetchManualWorkouts(): Promise<CachedReadResult<ManualWorkoutListResponse>> {
  const token = await requireSessionToken();

  try {
    const response = await contractClient.manualWorkouts({
      extraHeaders: buildAuthHeaders(token),
    });

    if (response.status !== 200) {
      throw toApiRequestError(response.status, response.body);
    }

    await writeCache(storageKeys.manualWorkouts, response.body, token);

    return {
      data: response.body,
      source: 'network',
    };
  } catch (error) {
    if (!isNetworkFailure(error)) {
      throw error;
    }

    const cached = await readCache<ManualWorkoutListResponse>(storageKeys.manualWorkouts);
    if (!cached) {
      throw error;
    }

    return {
      data: cached,
      source: 'cache',
    };
  }
}

export async function createManualWorkout(workout: ManualWorkoutCreate): Promise<ManualWorkout> {
  const token = await requireSessionToken();

  const response = await contractClient.createManualWorkout({
    extraHeaders: buildAuthHeaders(token),
    body: workout,
  });

  if (response.status !== 200) {
    throw toApiRequestError(response.status, response.body);
  }

  await updateCachedManualWorkouts((current) => ({
    workouts: [response.body, ...current.workouts.filter((entry) => entry.id !== response.body.id)],
  }), token);

  return response.body;
}

export async function deleteManualWorkout(workoutId: string) {
  const token = await requireSessionToken();

  const response = await contractClient.deleteManualWorkout({
    extraHeaders: buildAuthHeaders(token),
    params: {
      workoutId,
    },
  });

  if (response.status !== 200) {
    throw toApiRequestError(response.status, response.body);
  }

  await updateCachedManualWorkouts((current) => ({
    workouts: current.workouts.filter((entry) => entry.id !== workoutId),
  }), token);

  return response.body;
}

export async function fetchPreferences(): Promise<CachedReadResult<Preferences>> {
  const token = await requireSessionToken();
  const revision = preferenceWriteRevision;
  const pending = (await readPendingMutations()).filter((mutation) => mutation.type === 'updatePreferences').at(-1);
  if (pending?.type === 'updatePreferences') {
    await assertCurrentSession(token);
    return { data: pending.payload, source: 'cache' };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await contractClient.preferences({
      extraHeaders: buildAuthHeaders(token),
      fetchOptions: { signal: controller.signal },
    });

    if (response.status !== 200) {
      throw toApiRequestError(response.status, response.body);
    }

    if (revision !== preferenceWriteRevision) {
      await assertCurrentSession(token);
      const cached = await readCache<Preferences>(storageKeys.preferences);
      return { data: cached ?? response.body, source: cached ? 'cache' : 'network' };
    }
    await writeCache(storageKeys.preferences, response.body, token);

    return {
      data: response.body,
      source: 'network',
    };
  } catch (error) {
    const temporarilyUnavailable = error instanceof ApiRequestError && (error.status >= 500 || error.status === 429);
    if (!isNetworkFailure(error) && !controller.signal.aborted && !temporarilyUnavailable) {
      throw error;
    }

    await assertCurrentSession(token);
    const cached = await readCache<Preferences>(storageKeys.preferences);
    if (!cached) {
      throw error;
    }

    return {
      data: cached,
      source: 'cache',
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchWorkoutsByMode(
  mode: WorkoutMode,
  options: FetchWorkoutsOptions = {},
): Promise<CachedReadResult<WorkoutListResponse>> {
  const token = await requireSessionToken();

  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 20;
  const order = options.order ?? 'published_at_desc_created_at_desc_id_asc';
  const cacheKey = `${storageKeys.workoutsPrefix}${mode}/${page}/${pageSize}/${order}`;

  try {
    const response = await contractClient.workoutsByMode({
      extraHeaders: buildAuthHeaders(token),
      query: {
        mode,
        page,
        pageSize,
        order,
      },
    });

    if (response.status !== 200) {
      throw toApiRequestError(response.status, response.body);
    }

    await writeCache(cacheKey, response.body, token);

    return {
      data: response.body,
      source: 'network',
    };
  } catch (error) {
    if (!isNetworkFailure(error)) {
      throw error;
    }

    const cached = await readCache<WorkoutListResponse>(cacheKey);
    if (!cached) {
      throw error;
    }

    return {
      data: cached,
      source: 'cache',
    };
  }
}

export async function updatePreferences(preferences: Preferences) {
  const token = await requireSessionToken();
  return serializePreferences(() => persistPreferences(preferences, token));
}

// Synchronize only appearance/preferences here; opening the app must not flush
// unrelated progress or device-registration work as a side effect of theming.
export async function syncPendingPreferences() {
  const token = await requireSessionToken();
  return serializePreferences(async () => {
    await assertCurrentSession(token);
    const pending = (await readPendingMutations()).filter((mutation) => mutation.type === 'updatePreferences').at(-1);
    if (pending?.type !== 'updatePreferences') return;
    const owner = await getCachedUser();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await contractClient.me({ extraHeaders: buildAuthHeaders(token), fetchOptions: { signal: controller.signal } });
      if (!owner || response.status !== 200 || response.body.id !== owner.id) throw new ApiRequestError(401, 'Queued changes belong to a different account.', 'invalid_auth');
      return await persistPreferences(pending.payload, token);
    } finally { clearTimeout(timeout); }
  });
}

async function persistPreferences(preferences: Preferences, token: string) {
  await assertCurrentSession(token);
  preferenceWriteRevision++;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await contractClient.updatePreferences({
      extraHeaders: buildAuthHeaders(token),
      body: preferences,
      fetchOptions: { signal: controller.signal },
    });

    if (response.status !== 200) {
      throw toApiRequestError(response.status, response.body);
    }

    await removePendingMutationsByType('updatePreferences', token);
    await writeCache(storageKeys.preferences, preferences, token);
    await notifyPreferences(preferences, token);

    return {
      queued: false,
    };
  } catch (error) {
    const temporarilyUnavailable = error instanceof ApiRequestError && (error.status >= 500 || error.status === 429);
    if (!isNetworkFailure(error) && !controller.signal.aborted && !temporarilyUnavailable) {
      throw error;
    }

    await queuePendingMutation({
      id: makeMutationId(),
      createdAt: new Date().toISOString(),
      type: 'updatePreferences',
      payload: preferences,
    }, token);
    await writeCache(storageKeys.preferences, preferences, token);
    await notifyPreferences(preferences, token);

    return {
      queued: true,
    };
  } finally {
    preferenceWriteRevision++;
    clearTimeout(timeout);
  }
}

export async function registerDevice(device: NotificationDevice) {
  const token = await requireSessionToken();

  try {
    const response = await contractClient.registerDevice({
      extraHeaders: buildAuthHeaders(token),
      body: device,
    });

    if (response.status !== 200) {
      throw toApiRequestError(response.status, response.body);
    }

    return {
      queued: false,
    };
  } catch (error) {
    if (!isNetworkFailure(error)) {
      throw error;
    }

    await queuePendingMutation({
      id: makeMutationId(),
      createdAt: new Date().toISOString(),
      type: 'registerDevice',
      payload: device,
    }, token);

    return {
      queued: true,
    };
  }
}

export function flushPendingMutations() {
  return serializePreferences(flushPendingMutationsSerial);
}
async function flushPendingMutationsSerial() {
  const token = await getSessionToken();
  if (!token) {
    return {
      flushed: 0,
      remaining: (await readPendingMutations()).length,
    };
  }

  const key = await accountStorageKey(storageKeys.pendingMutations);
  await assertCurrentSession(token);
  const queue = coalescePendingMutations(await readPendingMutations(key));
  if (queue.length === 0) {
    return {
      flushed: 0,
      remaining: 0,
    };
  }

  const owner = await getCachedUser();
  if (owner) {
    const response = await contractClient.me({ extraHeaders: buildAuthHeaders(token) });
    if (response.status !== 200 || response.body.id !== owner.id) throw new ApiRequestError(401, 'Queued changes belong to a different account.', 'invalid_auth');
    await assertCurrentSession(token);
  }

  const remaining: PendingMutation[] = [];
  let flushed = 0;

  for (const mutation of queue) {
    await assertCurrentSession(token);
    try {
      await executePendingMutation(mutation, token);
      flushed += 1;
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) throw error;
      if (isNetworkFailure(error) || (error instanceof ApiRequestError && (error.status === 429 || error.status >= 500))) {
        remaining.push(mutation);
        continue;
      }

      // Drop non-retriable mutations and continue with later entries.
    }
  }

  await assertCurrentSession(token);
  await writePendingMutations(key, remaining);

  return {
    flushed,
    remaining: remaining.length,
  };
}

export async function getPendingMutationCount() {
  return (await readPendingMutations()).length;
}

export function __setApiTestAdapters(input: {
  storage?: StorageLike;
  client?: ContractClientLike;
}) {
  if (input.storage) {
    storage = input.storage;
    migratedUsers.clear(); migration = Promise.resolve();
  }

  if (input.client) {
    contractClient = input.client;
  }
}

export function __resetApiTestAdapters() {
  storage = defaultStorage;
  migratedUsers.clear(); migration = Promise.resolve();
  contractClient = apiClient;
}
