import type { OAuthProviderAdapter } from './auth-types.js';
import { env } from './env.js';
import { ApiError } from './api-error.js';

export type WhoopOperation = 'profile' | 'dashboard' | 'sync' | 'sharing' | 'export' | 'disconnect' | 'delete';
export interface WhoopService {
  provider: OAuthProviderAdapter;
  request(subject: string, operation: WhoopOperation, method: 'GET' | 'POST' | 'DELETE',
    query?: Record<string, string>, body?: unknown): Promise<{ status: number; body: string; contentType: string }>;
  ownsWorkout(subject: string, sourceId: string): Promise<boolean>;
  workouts(subject: string): Promise<Array<{ id: string; date: string; start: string; label: string }>>;
  close(): Promise<void>;
}

export function createWhoopService(): WhoopService | undefined {
  const values = [env.WHOOP_DATABASE_URL, env.WHOOP_CLIENT_ID, env.WHOOP_CLIENT_SECRET, env.WHOOP_TOKEN_KEY];
  if (values.every((value) => !value)) return undefined;
  if (values.some((value) => !value)) throw new Error('Configure all WHOOP connection settings together.');
  // Import only when explicitly enabled. Never fall back to the application database.
  const module = () => import('@3plates/whoop/integration');
  return {
    provider: {
      provider: 'whoop',
      buildAuthorizationUrl({ state, redirectUri }) {
        return 'https://api.prod.whoop.com/oauth/oauth2/auth?' + new URLSearchParams({
          client_id: env.WHOOP_CLIENT_ID!, redirect_uri: redirectUri, response_type: 'code', state,
          scope: 'offline read:profile read:cycles read:sleep read:recovery read:workout read:body_measurement',
        });
      },
      async exchangeCode(input) {
        try { return await (await module()).authorize(input); }
        catch { throw new ApiError(503, 'internal_error', 'WHOOP authorization failed. Please reconnect.'); }
      },
    },
    async request(...args) { return (await module()).memberRequest(...args); },
    async ownsWorkout(...args) { return (await module()).ownsWorkout(...args); },
    async workouts(subject) { return (await module()).workoutChoices(subject); },
    async close() { await (await module()).closeIntegration(); },
  };
}
