import { createHash } from 'node:crypto';
import { and, asc, eq, gt, gte, lte } from 'drizzle-orm';
import { createDatabaseClient, healthLogs, healthMutations, users } from '@3plates/db';
import { healthLogSchema, healthMutationSchema } from '@3plates/contract';
import type { HealthLog, HealthLogPage, HealthLogQuery, HealthMutation } from '@3plates/contract';
import { conflictOrStaleUpdateError, invalidAuthError } from './api-error.js';

export interface HealthStore {
  list(userId: string, query: HealthLogQuery): Promise<HealthLogPage>;
  mutate(userId: string, mutation: HealthMutation, validate?: () => Promise<void>): Promise<HealthLog>;
  close(): Promise<void>;
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const conflict = () => conflictOrStaleUpdateError('This entry changed on another device. Reload it before saving.');
function next(current: HealthLog | undefined, mutation: HealthMutation): HealthLog {
  if ((current?.version ?? 0) !== mutation.expectedVersion || current?.entry === null || (!current && !mutation.entry)) throw conflict();
  const now = new Date().toISOString();
  return healthLogSchema.parse({ id: mutation.id, version: (current?.version ?? 0) + 1,
    entry: mutation.entry, createdAt: current?.createdAt ?? now, updatedAt: now });
}
function project(row: typeof healthLogs.$inferSelect) {
  return healthLogSchema.parse({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
}

export function createDbHealthStore(connectionString: string): HealthStore {
  const { db, close } = createDatabaseClient(connectionString);
  return {
    async list(userId, query) {
      const rows = await db.select().from(healthLogs).where(and(
        eq(healthLogs.userId, userId), query.start ? gte(healthLogs.date, query.start) : undefined,
        query.end ? lte(healthLogs.date, query.end) : undefined,
        query.cursor ? gt(healthLogs.id, query.cursor) : undefined,
      )).orderBy(asc(healthLogs.id)).limit(query.limit + 1);
      return { logs: rows.slice(0, query.limit).map(project), nextCursor: rows.length > query.limit ? rows[query.limit - 1].id : null };
    },
    async mutate(userId, input, validate) {
      const mutation = healthMutationSchema.parse(input);
      const requestHash = digest(mutation);
      return db.transaction(async (tx) => {
        // Serialize writes per user, including first inserts and duplicate retries.
        // No in-process lock: this also works across API processes.
        const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
        if (!user || user.deletionRequestedAt) throw invalidAuthError();
        const [receipt] = await tx.select().from(healthMutations).where(and(
          eq(healthMutations.userId, userId), eq(healthMutations.id, mutation.mutationId),
        ));
        if (receipt) {
          if (receipt.requestHash !== requestHash) throw conflictOrStaleUpdateError('A mutation ID cannot be reused for a different change.');
          return healthLogSchema.parse(receipt.response);
        }
        if (validate) await validate();
        const [row] = await tx.select().from(healthLogs).where(and(eq(healthLogs.userId, userId), eq(healthLogs.id, mutation.id)));
        const result = next(row ? project(row) : undefined, mutation);
        const values = { version: result.version, entry: result.entry, date: result.entry?.date ?? row!.date,
          updatedAt: new Date(result.updatedAt) };
        if (row) await tx.update(healthLogs).set(values).where(and(eq(healthLogs.userId, userId), eq(healthLogs.id, mutation.id)));
        else await tx.insert(healthLogs).values({ ...values, userId, id: result.id, createdAt: new Date(result.createdAt) });
        await tx.insert(healthMutations).values({ id: mutation.mutationId, userId, requestHash, response: result });
        return result;
      });
    },
    close,
  };
}

export function createMemoryHealthStore(): HealthStore {
  const rows = new Map<string, { record: HealthLog; date: string }>();
  const receipts = new Map<string, { hash: string; record: HealthLog }>();
  return {
    async list(userId, query) {
      const all = [...rows.entries()].filter(([key, value]) => key.startsWith(userId + ':')
        && (!query.start || value.date >= query.start) && (!query.end || value.date <= query.end)
        && (!query.cursor || value.record.id > query.cursor)).map(([, value]) => value.record)
        .sort((a, b) => a.id.localeCompare(b.id));
      return { logs: structuredClone(all.slice(0, query.limit)), nextCursor: all.length > query.limit ? all[query.limit - 1].id : null };
    },
    async mutate(userId, input, validate) {
      const mutation = healthMutationSchema.parse(input);
      const key = userId + ':' + mutation.id;
      const receiptKey = userId + ':' + mutation.mutationId;
      const receipt = receipts.get(receiptKey);
      if (receipt) {
        if (receipt.hash !== digest(mutation)) throw conflictOrStaleUpdateError('A mutation ID cannot be reused for a different change.');
        return structuredClone(receipt.record);
      }
      if (validate) await validate();
      const retried = receipts.get(receiptKey);
      if (retried) {
        if (retried.hash !== digest(mutation)) throw conflictOrStaleUpdateError('A mutation ID cannot be reused for a different change.');
        return structuredClone(retried.record);
      }
      const current = rows.get(key);
      const record = next(current?.record, mutation);
      rows.set(key, { record, date: record.entry?.date ?? current!.date });
      receipts.set(receiptKey, { hash: digest(mutation), record });
      return structuredClone(record);
    },
    async close() {},
  };
}
