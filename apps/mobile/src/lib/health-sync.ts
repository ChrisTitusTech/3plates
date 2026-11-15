import { healthLogInputSchema, healthLogPageSchema, healthLogSchema } from '@3plates/contract';
import type { HealthLog, HealthLogInput, HealthMutation } from '@3plates/contract';

export class SyncFailure extends Error {
  constructor(public status: number, message: string) { super(message); }
}
type Pending = { mutation: HealthMutation; error?: string };
type State = { records: Record<string, HealthLog>; pending: Pending[] };
export type HealthSync = ReturnType<typeof createHealthSync>;
export function createHealthSync(options: {
  userId: string;
  storage: { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; removeItem(key: string): Promise<void> };
  request(path: string, mutation?: HealthMutation): Promise<unknown>;
  uuid(): string;
  lock?<T>(key: string, run: () => Promise<T>): Promise<T>;
}) {
  const key = `@3plates/health/${options.userId}`;
  let serial: Promise<unknown> = Promise.resolve();
  async function read(): Promise<State> {
    const raw = await options.storage.getItem(key);
    if (!raw) return { records: {}, pending: [] };
    // Do not silently discard corrupt local data, which may include unsent edits.
    const state = JSON.parse(raw) as State;
    if (!state.records || !Array.isArray(state.pending)) throw new Error('Local log storage needs recovery. Your data has not been discarded.');
    return state;
  }
  const persist = (state: State) => options.storage.setItem(key, JSON.stringify(state));
  function exclusive<T>(run: () => Promise<T>): Promise<T> {
    const next = serial.catch(() => undefined).then(() => options.lock ? options.lock(key, run) : run());
    serial = next;
    return next;
  }
  async function sendPending(state: State) {
    const blocked = new Set<string>();
    for (const pending of [...state.pending]) {
      const id = pending.mutation.id;
      if (pending.error || blocked.has(id)) { blocked.add(id); continue; }
      try {
        const saved = healthLogSchema.parse(await options.request('/users/me/logs', pending.mutation));
        state.pending = state.pending.filter((item) => item.mutation.mutationId !== pending.mutation.mutationId);
        // Keep the newer optimistic record if this ID has additional queued edits.
        if (!state.pending.some((item) => item.mutation.id === id)) state.records[id] = saved;
        await persist(state);
      } catch (error) {
        if (error instanceof SyncFailure && error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 429) {
          pending.error = error.message;
          blocked.add(id);
          await persist(state);
          continue;
        }
        // Lost acknowledgements retain the exact mutation ID for a safe retry.
        throw error;
      }
    }
  }
  return {
    snapshot: () => exclusive(async () => {
      const state = await read();
      return { logs: Object.values(state.records).filter((row) => row.entry)
        .sort((a, b) => b.entry!.date.localeCompare(a.entry!.date) || b.updatedAt.localeCompare(a.updatedAt)),
        pending: state.pending.length, conflicts: state.pending.filter((item) => item.error),
      };
    }),
    save: (entry: HealthLogInput, id = options.uuid(), expectedVersion?: number) => exclusive(async () => {
      const value = healthLogInputSchema.parse(entry);
      const state = await read();
      if (state.pending.some((item) => item.mutation.id === id && item.error)) throw new Error('Resolve the sync conflict before editing it.');
      const current = state.records[id];
      if (expectedVersion !== undefined && expectedVersion !== (current?.version ?? 0)) {
        throw new Error('This entry changed while you were editing. Your form is preserved; reload the entry before saving.');
      }
      const now = new Date().toISOString();
      const mutation: HealthMutation = { mutationId: options.uuid(), id, expectedVersion: current?.version ?? 0, entry: value };
      state.pending.push({ mutation });
      state.records[id] = { id, version: mutation.expectedVersion + 1, entry: value, createdAt: current?.createdAt ?? now, updatedAt: now };
      await persist(state);
      return id;
    }),
    remove: (id: string) => exclusive(async () => {
      const state = await read();
      const current = state.records[id];
      if (!current?.entry) return;
      if (state.pending.some((item) => item.mutation.id === id && item.error)) throw new Error('Resolve the sync conflict before deleting it.');
      state.pending.push({ mutation: { mutationId: options.uuid(), id, expectedVersion: current.version, entry: null } });
      state.records[id] = { ...current, version: current.version + 1, entry: null, updatedAt: new Date().toISOString() };
      await persist(state);
    }),
    synchronize: () => exclusive(async () => {
      const state = await read();
      await sendPending(state);
      let cursor: string | null = null;
      do {
        const page = healthLogPageSchema.parse(await options.request('/users/me/logs?limit=200' + (cursor ? `&cursor=${cursor}` : '')));
        for (const record of page.logs) if (!state.pending.some((item) => item.mutation.id === record.id)) state.records[record.id] = record;
        cursor = page.nextCursor;
      } while (cursor);
      await persist(state);
    }),
    // Explicit user choice. A fresh copy is fetched before discarding local
    // changes, so an offline conflict-resolution attempt cannot destroy edits.
    acceptServer: (id: string) => exclusive(async () => {
      const state = await read();
      let cursor: string | null = null;
      let found: HealthLog | undefined;
      do {
        const page = healthLogPageSchema.parse(await options.request('/users/me/logs?limit=200' + (cursor ? `&cursor=${cursor}` : '')));
        found ??= page.logs.find((row) => row.id === id);
        cursor = page.nextCursor;
      } while (cursor && !found);
      state.pending = state.pending.filter((item) => item.mutation.id !== id);
      if (found) state.records[id] = found;
      else delete state.records[id];
      await persist(state);
    }),
    clear: () => exclusive(() => options.storage.removeItem(key)),
  };
}
