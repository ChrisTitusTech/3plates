import { eq, and, desc } from 'drizzle-orm';
import { z } from 'zod';
import { detail } from './domain.js';
import { buildApp } from './app.js';
import { config, origin, scopes } from './config.js';
import { db, client } from './db.js';
import { members, records } from './schema.js';
import { encrypt } from './security.js';
import { enqueueSync } from './sync.js';
import { reserveRequest, tokenRequest } from './whoop.js';

// This server is never listened on. Headers are constructed by this adapter,
// not forwarded from the user's request. Legacy cookie authentication stays
// unchanged in the standalone compatibility dashboard.
let embedded: ReturnType<typeof buildApp> | undefined;
function server() {
  return embedded ??= buildApp({
    serveStatic: false,
    resolveMember: async (request) => {
      const subject = request.headers['x-internal-whoop-subject'];
      if (typeof subject !== 'string') return null;
      const [member] = await db.select().from(members).where(eq(members.whoopId, subject));
      return member ?? null;
    },
  });
}

export function authorizationUrl(input: { state: string; redirectUri: string }) {
  const params = new URLSearchParams({
    client_id: config.ClientID, redirect_uri: input.redirectUri,
    response_type: 'code', scope: scopes, state: input.state,
  });
  return `https://api.prod.whoop.com/oauth/oauth2/auth?${params}`;
}

export async function authorize(input: { code: string; redirectUri: string }) {
  await reserveRequest();
  const tokens = await tokenRequest({
    grant_type: 'authorization_code', code: input.code, redirect_uri: input.redirectUri,
  });
  await reserveRequest();
  const response = await fetch('https://api.prod.whoop.com/developer/v2/user/profile/basic', {
    headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error('WHOOP profile request failed.');
  const profile = z.object({
    user_id: z.number().int().positive(), first_name: z.string(), last_name: z.string(),
    email: z.string().email().optional(),
  }).parse(await response.json());
  const subject = String(profile.user_id);
  const name = `${profile.first_name} ${profile.last_name}`.trim();
  return { provider: 'whoop' as const, providerSubjectId: subject,
    email: profile.email ?? null, emailVerified: false, displayName: name,
    // Tokens remain local to this callback until 3plates accepts and locks the identity.
    activate: async () => {
      await db.transaction(async (tx) => {
        const [member] = await tx.insert(members).values({
          whoopId: subject, name, email: profile.email, tokens: encrypt(tokens, config.TOKEN_KEY),
        }).onConflictDoUpdate({ target: members.whoopId, set: {
          name, email: profile.email, tokens: encrypt(tokens, config.TOKEN_KEY), connected: true,
        } }).returning();
        await enqueueSync(tx, member.id, 'full');
      });
    },
  };
}

export type MemberOperation = 'profile' | 'dashboard' | 'sync' | 'sharing' | 'export' | 'disconnect' | 'delete';
const paths: Record<MemberOperation, string> = {
  profile: '/api/me', dashboard: '/api/me/dashboard', sync: '/api/me/sync',
  sharing: '/api/me/sharing', export: '/api/me/export', disconnect: '/api/me/disconnect', delete: '/api/me',
};
export async function memberRequest(subject: string, operation: MemberOperation,
  method: 'GET' | 'POST' | 'DELETE', query: Record<string, string> = {}, body?: unknown) {
  const app = await server();
  const result = await app.inject({
    method, url: paths[operation] + '?' + new URLSearchParams(query),
    headers: { 'x-internal-whoop-subject': subject, origin,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
  return { status: result.statusCode, body: result.body,
    contentType: String(result.headers['content-type'] ?? 'application/json') };
}

export async function ownsWorkout(subject: string, sourceId: string) {
  const [row] = await db.select({ id: records.id }).from(records)
    .innerJoin(members, eq(records.memberId, members.id))
    .where(and(eq(members.whoopId, subject), eq(records.kind, 'workout'),
      eq(records.sourceId, sourceId), eq(records.deleted, false))).limit(1);
  return !!row;
}

export async function closeIntegration() {
  if (embedded) { await (await embedded).close(); embedded = undefined; }
  await client.end({ timeout: 5 });
}

export async function workoutChoices(subject: string, date?: string) {
  const rows = await db.select({ record: records }).from(records)
    .innerJoin(members, eq(records.memberId, members.id))
    .where(and(eq(members.whoopId, subject), eq(records.kind, 'workout'), eq(records.deleted, false), date ? eq(records.localDate, date) : undefined))
    .orderBy(desc(records.start)).limit(200);
  return rows.map(({ record }) => ({ id: record.sourceId, date: record.localDate,
    start: record.start.toISOString(), label: `${record.localDate} ${detail(record).sport ?? 'Workout'}` }));
}
