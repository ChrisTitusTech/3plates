import { initClient } from '@ts-rest/core';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { appContract } from '@3plates/contract';
import type {
  AuthProvider,
  NotificationDevice,
  Preferences,
  Progress,
  Workout,
  WorkoutMode,
  User,
} from '@3plates/contract';

const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

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
  | 'me'
  | 'progress'
  | 'updateProgress'
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

async function writeCache<T>(key: string, value: T) {
  const envelope: CacheEnvelope<T> = {
    value,
    updatedAt: new Date().toISOString(),
  };

  await storage.setItem(key, JSON.stringify(envelope));
}

async function readCache<T>(key: string): Promise<T | null> {
  const rawValue = await storage.getItem(key);
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as CacheEnvelope<T>;
    if (!parsed || typeof parsed !== 'object' || !('value' in parsed)) {
      return null;
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

async function readPendingMutations(): Promise<PendingMutation[]> {
  const rawValue = await storage.getItem(storageKeys.pendingMutations);
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

async function writePendingMutations(mutations: PendingMutation[]) {
  await storage.setItem(storageKeys.pendingMutations, JSON.stringify(mutations));
}

async function queuePendingMutation(mutation: PendingMutation) {
  const existing = await readPendingMutations();
  existing.push(mutation);

  await writePendingMutations(existing);
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

export async function setSessionToken(token: string | null) {
  await writeSessionToken(token);
}

export async function clearSession() {
  await writeSessionToken(null);
  await storage.removeItem(storageKeys.me);
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
  const token = await getSessionToken();
  if (!token) {
    throw new ApiRequestError(401, 'No session token is available.', 'invalid_auth');
  }

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
  await writeCache(storageKeys.me, response.body.user);

  return response.body;
}

export async function refreshSessionAndPersist() {
  const token = await getSessionToken();
  if (!token) {
    throw new ApiRequestError(401, 'No session token is available.', 'invalid_auth');
  }

  const response = await contractClient.authRefresh({
    extraHeaders: buildAuthHeaders(token),
    body: {},
  });

  if (response.status !== 200) {
    throw toApiRequestError(response.status, response.body);
  }

  await setSessionToken(response.body.sessionToken);
  await writeCache(storageKeys.me, response.body.user);

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
  await writeCache(storageKeys.me, response.body.user);

  return response.body;
}

export async function fetchMe(): Promise<CachedReadResult<User>> {
  const token = await getSessionToken();
  if (!token) {
    throw new ApiRequestError(401, 'No session token is available.', 'invalid_auth');
  }

  try {
    const response = await contractClient.me({
      extraHeaders: buildAuthHeaders(token),
    });

    if (response.status !== 200) {
      throw toApiRequestError(response.status, response.body);
    }

    await writeCache(storageKeys.me, response.body);

    return {
      data: response.body,
      source: 'network',
    };
  } catch (error) {
    if (!isNetworkFailure(error)) {
      throw error;
    }

    const cached = await readCache<User>(storageKeys.me);
    if (!cached) {
      throw error;
    }

    return {
      data: cached,
      source: 'cache',
    };
  }
}

export async function fetchProgress(): Promise<CachedReadResult<Progress>> {
  const token = await getSessionToken();
  if (!token) {
    throw new ApiRequestError(401, 'No session token is available.', 'invalid_auth');
  }

  try {
    const response = await contractClient.progress({
      extraHeaders: buildAuthHeaders(token),
    });

    if (response.status !== 200) {
      throw toApiRequestError(response.status, response.body);
    }

    await writeCache(storageKeys.progress, response.body);

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
  const token = await getSessionToken();
  if (!token) {
    throw new ApiRequestError(401, 'No session token is available.', 'invalid_auth');
  }

  try {
    const response = await contractClient.updateProgress({
      extraHeaders: buildAuthHeaders(token),
      body: progress,
    });

    if (response.status !== 200) {
      throw toApiRequestError(response.status, response.body);
    }

    await writeCache(storageKeys.progress, progress);

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
    });
    await writeCache(storageKeys.progress, progress);

    return {
      queued: true,
    };
  }
}

export async function fetchPreferences(): Promise<CachedReadResult<Preferences>> {
  const token = await getSessionToken();
  if (!token) {
    throw new ApiRequestError(401, 'No session token is available.', 'invalid_auth');
  }

  try {
    const response = await contractClient.preferences({
      extraHeaders: buildAuthHeaders(token),
    });

    if (response.status !== 200) {
      throw toApiRequestError(response.status, response.body);
    }

    await writeCache(storageKeys.preferences, response.body);

    return {
      data: response.body,
      source: 'network',
    };
  } catch (error) {
    if (!isNetworkFailure(error)) {
      throw error;
    }

    const cached = await readCache<Preferences>(storageKeys.preferences);
    if (!cached) {
      throw error;
    }

    return {
      data: cached,
      source: 'cache',
    };
  }
}

export async function fetchWorkoutsByMode(mode: WorkoutMode): Promise<CachedReadResult<Workout[]>> {
  const token = await getSessionToken();
  if (!token) {
    throw new ApiRequestError(401, 'No session token is available.', 'invalid_auth');
  }

  const cacheKey = `${storageKeys.workoutsPrefix}${mode}`;

  try {
    const response = await contractClient.workoutsByMode({
      extraHeaders: buildAuthHeaders(token),
      query: {
        mode,
      },
    });

    if (response.status !== 200) {
      throw toApiRequestError(response.status, response.body);
    }

    await writeCache(cacheKey, response.body.workouts);

    return {
      data: response.body.workouts,
      source: 'network',
    };
  } catch (error) {
    if (!isNetworkFailure(error)) {
      throw error;
    }

    const cached = await readCache<Workout[]>(cacheKey);
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
  const token = await getSessionToken();
  if (!token) {
    throw new ApiRequestError(401, 'No session token is available.', 'invalid_auth');
  }

  try {
    const response = await contractClient.updatePreferences({
      extraHeaders: buildAuthHeaders(token),
      body: preferences,
    });

    if (response.status !== 200) {
      throw toApiRequestError(response.status, response.body);
    }

    await writeCache(storageKeys.preferences, preferences);

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
      type: 'updatePreferences',
      payload: preferences,
    });
    await writeCache(storageKeys.preferences, preferences);

    return {
      queued: true,
    };
  }
}

export async function registerDevice(device: NotificationDevice) {
  const token = await getSessionToken();
  if (!token) {
    throw new ApiRequestError(401, 'No session token is available.', 'invalid_auth');
  }

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
    });

    return {
      queued: true,
    };
  }
}

export async function flushPendingMutations() {
  const token = await getSessionToken();
  if (!token) {
    return {
      flushed: 0,
      remaining: (await readPendingMutations()).length,
    };
  }

  const queue = await readPendingMutations();
  if (queue.length === 0) {
    return {
      flushed: 0,
      remaining: 0,
    };
  }

  const remaining: PendingMutation[] = [];
  let flushed = 0;

  for (const mutation of queue) {
    try {
      await executePendingMutation(mutation, token);
      flushed += 1;
    } catch (error) {
      if (isNetworkFailure(error)) {
        remaining.push(mutation);
        continue;
      }

      // Drop non-retriable mutations and continue with later entries.
    }
  }

  await writePendingMutations(remaining);

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
  }

  if (input.client) {
    contractClient = input.client;
  }
}

export function __resetApiTestAdapters() {
  storage = defaultStorage;
  contractClient = apiClient;
}
