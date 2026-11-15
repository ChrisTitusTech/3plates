import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { HealthLog, HealthLogInput, HealthMutation } from '@3plates/contract';
import { createHealthSync, SyncFailure } from './health-sync';
import { entryForm, formEntry, newLogForm } from './log-form';
import { workoutCount } from './workout-history';

const water = (milliliters = 250): HealthLogInput => ({ kind: 'hydration', date: '2026-11-14', timezone: 'America/Chicago', notes: '', details: { milliliters } });
function fixture() {
  const storageMap = new Map<string, string>();
  const storage = { async getItem(key: string) { return storageMap.get(key) ?? null; }, async setItem(key: string, value: string) { storageMap.set(key, value); }, async removeItem(key: string) { storageMap.delete(key); } };
  const records = new Map<string, HealthLog>();
  const receipts = new Map<string, HealthLog>();
  const attempts: HealthMutation[] = [];
  let failure = 0; let loseAck = false;
  const request = async (_path: string, mutation?: HealthMutation) => {
    if (failure) throw new SyncFailure(failure, 'Unavailable');
    if (!mutation) return { logs: [...records.values()], nextCursor: null };
    attempts.push(structuredClone(mutation));
    if (receipts.has(mutation.mutationId)) return receipts.get(mutation.mutationId);
    const current = records.get(mutation.id);
    if ((current?.version ?? 0) !== mutation.expectedVersion) throw new SyncFailure(409, 'Changed elsewhere');
    const row: HealthLog = { id: mutation.id, version: mutation.expectedVersion + 1, entry: mutation.entry, createdAt: current?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() };
    records.set(row.id, row); receipts.set(mutation.mutationId, structuredClone(row));
    if (loseAck) { loseAck = false; throw new Error('Lost response'); }
    return row;
  };
  const engine = (userId = 'alice') => createHealthSync({ userId, storage, request, uuid: randomUUID });
  return { engine, records, attempts, storageMap, setFailure: (value: number) => { failure = value; }, loseResponse: () => { loseAck = true; } };
}

test('offline edits survive restart and lost acknowledgements replay exactly once', async () => {
  const f = fixture(); let engine = f.engine();
  const id = await engine.save(water());
  await engine.save(water(500), id);
  f.setFailure(503); await assert.rejects(engine.synchronize());
  engine = f.engine(); assert.equal((await engine.snapshot()).pending, 2);
  f.setFailure(0); f.loseResponse(); await assert.rejects(engine.synchronize(), /Lost response/);
  assert.equal(f.records.get(id)?.version, 1);
  await engine.synchronize();
  assert.deepEqual(f.attempts[0], f.attempts[1]);
  assert.equal(f.records.get(id)?.version, 2);
  assert.deepEqual(f.records.get(id)?.entry, water(500));
  assert.equal((await engine.snapshot()).pending, 0);
  await engine.remove(id); await engine.synchronize();
  assert.equal(f.records.get(id)?.entry, null); assert.equal((await engine.snapshot()).logs.length, 0);
});

test('conflicts preserve edits until an explicit online resolution, without blocking other entries', async () => {
  const f = fixture(); const engine = f.engine();
  const id = await engine.save(water()); await engine.synchronize();
  await engine.save(water(400), id);
  f.records.set(id, { ...f.records.get(id)!, version: 2, entry: water(900) });
  await engine.save(water(150)); await engine.synchronize();
  const pending = await engine.snapshot(); assert.equal(pending.pending, 1); assert.equal(pending.conflicts.length, 1);
  assert.deepEqual(pending.logs.find((log) => log.id === id)?.entry, water(400));
  await assert.rejects(engine.save(water(), id), /Resolve/);
  f.setFailure(503); await assert.rejects(engine.acceptServer(id)); assert.equal((await engine.snapshot()).pending, 1);
  f.setFailure(0); await engine.acceptServer(id);
  assert.deepEqual((await engine.snapshot()).logs.find((log) => log.id === id)?.entry, water(900));
});

test('concurrent local saves serialize, identities are isolated, and 401 retains pending edits', async () => {
  const f = fixture(); const alice = f.engine(); const bob = f.engine('bob');
  await Promise.all(Array.from({ length: 15 }, () => alice.save(water())));
  assert.equal((await alice.snapshot()).pending, 15); assert.equal((await bob.snapshot()).logs.length, 0);
  f.setFailure(401); await assert.rejects(alice.synchronize());
  assert.equal((await alice.snapshot()).pending, 15); assert.equal((await alice.snapshot()).conflicts.length, 0);
  await bob.save(water()); await alice.clear();
  assert.equal((await bob.snapshot()).pending, 1); assert.equal((await alice.snapshot()).logs.length, 0);
});

test('imperial forms round-trip weights, distance, hydration, and sleep offsets', () => {
  const form = { ...newLogForm(), title: 'Squats', durationMinutes: '45', distance: '2', amount: '16', weight: '180' };
  const workout = formEntry('workout', form, [{ name: 'Squat', sets: [{ reps: '5', weight: '225' }] }], true);
  assert.equal(workout.kind, 'workout'); if (workout.kind !== 'workout') return;
  assert.equal(workout.details.distanceKm, 3.218688);
  const edit = entryForm(workout, true); assert.equal(edit.exercises[0].sets[0].weight, '225'); assert.equal(edit.form.distance, '2');
  const hydration = formEntry('hydration', form, [], true); assert.equal(entryForm(hydration, true).form.amount, '16');
  const sleep = formEntry('sleep', { ...form, startDate: '2026-11-01', startTime: '00:30', startOffset: '-05:00', endDate: '2026-11-01', endTime: '07:30', endOffset: '-06:00' }, [], false);
  assert.equal(entryForm(sleep, false).form.startOffset, '-05:00'); assert.equal(entryForm(sleep, false).form.endOffset, '-06:00');
  assert.throws(() => formEntry('hydration', { ...form, amount: '-4' }, [], false));
});

test('goal targets convert selected units on save and edit without changing other metrics', () => {
  for (const [metric, target, factor] of [
    ['weight_kg', 180, 0.45359237], ['hydration_ml', 64, 29.5735295625],
    ['calories', 2000, 1], ['protein_grams', 120, 1], ['workouts_per_week', 4, 1],
  ] as const) {
    for (const imperial of [true, false]) {
      const entry = formEntry('goal', { ...newLogForm(), metric, target: String(target) }, [], imperial);
      assert.equal(entry.kind, 'goal'); if (entry.kind !== 'goal') continue;
      assert.equal(entry.details.target, target * (imperial ? factor : 1));
      const edit = entryForm(entry, imperial);
      assert.equal(edit.form.target, String(target));
      assert.deepEqual(formEntry('goal', edit.form, [], imperial), entry);
    }
  }
});

test('workout totals deduplicate links only when imports or linked manual records exist', () => {
  const entry = formEntry('workout', { ...newLogForm(), title: 'Ride', durationMinutes: '30', linkedWhoopWorkoutId: 'whoop-1' }, [], false);
  const log: HealthLog = { id: randomUUID(), version: 1, entry, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const detail = { sourceId: 'whoop-1', kind: 'workout', date: '2026-11-14', start: '2026-11-14T12:00:00Z', end: null, state: 'SCORED', nap: false, sport: 'Cycling', metrics: {} };
  assert.equal(workoutCount([log], [detail]), 1);
  assert.equal(workoutCount([log], []), 1);
  assert.equal(workoutCount([log, { ...log, id: randomUUID() }], []), 1);
});

test('all paginated records, including remote deletion markers, replace cached versions', async () => {
  const f = fixture(); const original = f.engine(); const id = await original.save(water()); await original.synchronize();
  const records = Array.from({ length: 3 }, (_, i) => ({ id: i === 2 ? id : randomUUID(), version: i === 2 ? 2 : 1, entry: i === 2 ? null : water(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
  const storage = { async getItem(key: string) { return f.storageMap.get(key) ?? null; }, async setItem(key: string, value: string) { f.storageMap.set(key, value); }, async removeItem(key: string) { f.storageMap.delete(key); } };
  const pages: string[] = [];
  const engine = createHealthSync({ userId: 'alice', storage, uuid: randomUUID, request: async (path) => {
    pages.push(path);
    const second = path.includes('cursor=');
    return { logs: second ? records.slice(1) : records.slice(0, 1), nextCursor: second ? null : records[0].id };
  } });
  await engine.synchronize(); assert.equal(pages.length, 2);
  assert.equal((await engine.snapshot()).logs.length, 2);
  assert.equal((await engine.snapshot()).logs.some((log) => log.id === id), false);
});

test('a form keeps its original version when background sync learns about another device edit', async () => {
  const f = fixture(); const engine = f.engine(); const id = await engine.save(water()); await engine.synchronize();
  const openedVersion = (await engine.snapshot()).logs[0].version;
  f.records.set(id, { ...f.records.get(id)!, version: 2, entry: water(900) });
  await engine.synchronize();
  await assert.rejects(engine.save(water(400), id, openedVersion), /changed while you were editing/);
  assert.deepEqual((await engine.snapshot()).logs[0].entry, water(900));
  assert.equal((await engine.snapshot()).pending, 0);
});
