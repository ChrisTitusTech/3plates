import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db.js";
import { budgets, members } from "./schema.js";
import { config } from "./config.js";
import { decrypt, encrypt } from "./security.js";
export class ApiError extends Error {
  constructor(
    public status: number,
    public delay = 60,
  ) {
    super(`WHOOP request failed (${status})`);
  }
}
export class ReconnectError extends Error {
  constructor() {
    super("WHOOP authorization expired. Reconnect your account.");
  }
}
export type Tokens = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
};
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
  scope: z.string().optional(),
});
export async function tokenRequest(
  params: Record<string, string>,
): Promise<Tokens> {
  const response = await fetch(
    "https://api.prod.whoop.com/oauth/oauth2/token",
    {
      method: "POST",
      body: new URLSearchParams({
        ...params,
        client_id: config.ClientID,
        client_secret: config.ClientSecret,
      }),
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!response.ok) throw new ApiError(response.status);
  const t = tokenSchema.parse(await response.json());
  if (
    params.grant_type === "authorization_code" &&
    t.scope &&
    ![
      "read:cycles",
      "read:sleep",
      "read:recovery",
      "read:profile",
      "read:workout",
      "read:body_measurement",
    ].every((s) => t.scope!.split(" ").includes(s))
  )
    throw new Error("Required WHOOP permissions were not granted");
  return {
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: Date.now() + t.expires_in * 1000,
  };
}
// One transaction serializes the shared rolling request budget across web and worker processes.
export async function reserveRequest() {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(834701)`);
    const now = new Date();
    for (const [key, limit, duration] of [
      ["minute", 60, 60000],
      ["day", 8000, 86400000],
    ] as const) {
      const [b] = await tx.select().from(budgets).where(eq(budgets.key, key));
      if (b && b.resets > now && b.count >= limit)
        throw new ApiError(
          429,
          Math.ceil((b.resets.getTime() - now.getTime()) / 1000),
        );
      await tx
        .insert(budgets)
        .values({ key, count: 1, resets: new Date(now.getTime() + duration) })
        .onConflictDoUpdate({
          target: budgets.key,
          set:
            b && b.resets > now
              ? { count: b.count + 1 }
              : { count: 1, resets: new Date(now.getTime() + duration) },
        });
    }
    const [blocked] = await tx
      .select()
      .from(budgets)
      .where(eq(budgets.key, "blocked"));
    if (blocked && blocked.resets > now)
      throw new ApiError(
        429,
        Math.ceil((blocked.resets.getTime() - now.getTime()) / 1000),
      );
  });
}
export async function accessToken(
  memberId: string,
  forceOld?: string,
): Promise<string> {
  let revoked = false;
  const result = await db.transaction(async (tx) => {
    const [member] = await tx
      .select()
      .from(members)
      .where(eq(members.id, memberId))
      .for("update");
    if (!member?.tokens || !member.connected) return null;
    let tokens = decrypt<Tokens>(member.tokens, config.TOKEN_KEY);
    if (
      tokens.expires_at > Date.now() + 60000 &&
      (!forceOld || tokens.access_token !== forceOld)
    )
      return tokens.access_token;
    try {
      await reserveRequest();
      tokens = await tokenRequest({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        scope: "offline",
      });
      await tx
        .update(members)
        .set({ tokens: encrypt(tokens, config.TOKEN_KEY) })
        .where(eq(members.id, memberId));
      return tokens.access_token;
    } catch (error) {
      if (error instanceof ApiError && [400, 401, 403].includes(error.status)) {
        await tx
          .update(members)
          .set({ connected: false, tokens: null, shareToken: null })
          .where(eq(members.id, memberId));
        revoked = true;
        return null;
      }
      throw error;
    }
  });
  if (!result || revoked) throw new ReconnectError();
  return result;
}
export async function requestWhoop(
  memberId: string,
  path: string,
  method = "GET",
): Promise<any> {
  let token = await accessToken(memberId);
  for (let attempt = 0; attempt < 2; attempt++) {
    await reserveRequest();
    const response = await fetch(
      "https://api.prod.whoop.com/developer/v2" + path,
      {
        method,
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20000),
      },
    );
    if (response.status === 401 && attempt === 0) {
      token = await accessToken(memberId, token);
      continue;
    }
    const reset = Math.max(
      1,
      Math.min(
        86400,
        Number(response.headers.get("x-ratelimit-reset")) ||
          Number(response.headers.get("retry-after")) ||
          60,
      ),
    );
    if (
      response.status === 429 ||
      response.headers.get("x-ratelimit-remaining") === "0"
    ) {
      await db
        .insert(budgets)
        .values({
          key: "blocked",
          count: 0,
          resets: new Date(Date.now() + reset * 1000),
        })
        .onConflictDoUpdate({
          target: budgets.key,
          set: { resets: new Date(Date.now() + reset * 1000) },
        });
    }
    if ([401, 403].includes(response.status)) {
      await db
        .update(members)
        .set({ connected: false, tokens: null, shareToken: null })
        .where(and(eq(members.id, memberId), eq(members.connected, true)));
      throw new ReconnectError();
    }
    if (!response.ok) throw new ApiError(response.status, reset);
    return response.status === 204 ? null : response.json();
  }
  throw new ReconnectError();
}
