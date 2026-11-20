import { authSessions, type createDatabaseClient } from '@3plates/db';
import { and, eq, isNull } from 'drizzle-orm';

export type LinkSession = {
  tokenHash: string;
  generation: number;
};

type Transaction = Parameters<Parameters<ReturnType<typeof createDatabaseClient>['db']['transaction']>[0]>[0];

export async function lockActiveLinkSession(tx: Transaction, userId: string, session: LinkSession) {
  const [active] = await tx.select({ expiresAt: authSessions.expiresAt }).from(authSessions)
    .where(and(
      eq(authSessions.tokenHash, session.tokenHash),
      eq(authSessions.userId, userId),
      eq(authSessions.authGeneration, session.generation),
      isNull(authSessions.revokedAt),
    )).for('update');
  return !!active && active.expiresAt.getTime() > Date.now();
}
