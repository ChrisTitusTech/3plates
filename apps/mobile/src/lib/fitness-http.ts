import { SyncFailure } from './health-sync';

export async function fetchFitnessText(url: string, token: string, method: string, body?: unknown, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method, signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new SyncFailure(response.status, typeof error?.error === 'string' ? error.error : error?.error?.message ?? 'Request failed. Please retry.');
    }
    return await response.text();
  } finally { clearTimeout(timeout); }
}
