import { z } from 'zod';

export const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}, 'Use a real calendar date.');
const timezone = z.string().min(1).max(80).refine((value) => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}, 'Use a valid timezone.');
const note = z.string().max(4000).default('');
const base = z.object({ date: calendarDateSchema, timezone, notes: note });
const amount = z.number().finite().nonnegative().max(100000);
const rating = z.number().int().min(1).max(10);
const set = z.object({ reps: z.number().int().min(1).max(1000), weightKg: z.number().min(0).max(2000) });

export const healthLogInputSchema = z.discriminatedUnion('kind', [
  base.extend({ kind: z.literal('workout'), details: z.object({
    title: z.string().trim().min(1).max(200), sport: z.string().trim().min(1).max(80),
    durationMinutes: z.number().positive().max(1440), distanceKm: amount.optional(),
    exercises: z.array(z.object({ name: z.string().trim().min(1).max(100), sets: z.array(set).min(1).max(50) })).max(100).default([]),
    linkedWhoopWorkoutId: z.string().min(1).max(100).nullable().default(null),
  }) }),
  base.extend({ kind: z.literal('nutrition'), details: z.object({
    meal: z.string().trim().min(1).max(200), calories: amount, proteinGrams: amount,
    carbohydrateGrams: amount, fatGrams: amount,
  }) }),
  base.extend({ kind: z.literal('hydration'), details: z.object({ milliliters: z.number().positive().max(20000) }) }),
  base.extend({ kind: z.literal('sleep'), details: z.object({
    start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }),
    nap: z.boolean().default(false), quality: rating,
  }).refine((value) => {
    const duration = Date.parse(value.end) - Date.parse(value.start);
    return duration > 0 && duration <= 48 * 3600000;
  }, 'Sleep end must follow start, within 48 hours.') }),
  base.extend({ kind: z.literal('recovery'), details: z.object({
    energy: rating, soreness: rating, stress: rating, mood: rating,
    tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  }) }),
  base.extend({ kind: z.literal('weight'), details: z.object({ kilograms: z.number().positive().max(1000) }) }),
  base.extend({ kind: z.literal('goal'), details: z.object({
    metric: z.enum(['workouts_per_week', 'hydration_ml', 'calories', 'protein_grams', 'weight_kg']),
    target: z.number().positive().max(100000),
  }) }),
]);
export const healthLogSchema = z.object({
  id: z.string().uuid(), version: z.number().int().positive(),
  entry: healthLogInputSchema.nullable(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export const healthMutationSchema = z.object({
  mutationId: z.string().uuid(), id: z.string().uuid(), expectedVersion: z.number().int().nonnegative(),
  entry: healthLogInputSchema.nullable(),
});
export const healthLogQuerySchema = z.object({
  start: calendarDateSchema.optional(), end: calendarDateSchema.optional(),
  cursor: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(200).default(100),
}).refine((value) => !value.start || !value.end || value.start <= value.end, 'Invalid date range.');
export const healthLogPageSchema = z.object({ logs: z.array(healthLogSchema), nextCursor: z.string().uuid().nullable() });
export type HealthLogInput = z.infer<typeof healthLogInputSchema>;
export type HealthLog = z.infer<typeof healthLogSchema>;
export type HealthMutation = z.infer<typeof healthMutationSchema>;
export type HealthLogQuery = z.infer<typeof healthLogQuerySchema>;
export type HealthLogPage = z.infer<typeof healthLogPageSchema>;
