import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarDateSchema, healthLogInputSchema, healthLogQuerySchema } from './health.js';

test('health log validation rejects invalid dates, zones, quantities and sleep intervals', () => {
  assert.equal(calendarDateSchema.safeParse('2024-02-29').success, true);
  assert.equal(calendarDateSchema.safeParse('2026-02-29').success, false);
  const water = { kind: 'hydration', date: '2026-11-14', timezone: 'America/Chicago', details: { milliliters: 250 } };
  assert.equal(healthLogInputSchema.safeParse(water).success, true);
  assert.equal(healthLogInputSchema.safeParse({ ...water, timezone: 'Imaginary/Place' }).success, false);
  for (const milliliters of [-1, 0, 20001, Infinity, NaN]) assert.equal(healthLogInputSchema.safeParse({ ...water, details: { milliliters } }).success, false);
  const sleep = { ...water, kind: 'sleep', details: { start: '2026-11-14T22:00:00-06:00', end: '2026-11-15T07:00:00-06:00', quality: 5 } };
  assert.equal(healthLogInputSchema.safeParse(sleep).success, true);
  assert.equal(healthLogInputSchema.safeParse({ ...sleep, details: { ...sleep.details, end: sleep.details.start } }).success, false);
  assert.equal(healthLogInputSchema.safeParse({ ...sleep, details: { ...sleep.details, end: '2026-11-18T07:00:00-06:00' } }).success, false);
  assert.equal(healthLogQuerySchema.safeParse({ start: '2026-11-15', end: '2026-11-14' }).success, false);
});
