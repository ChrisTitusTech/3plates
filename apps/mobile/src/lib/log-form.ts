import { healthLogInputSchema, type HealthLogInput } from '@3plates/contract';

export type LogKind = HealthLogInput['kind'];
export type ExerciseForm = { name: string; sets: Array<{ reps: string; weight: string }> };
export type LogForm = Record<string, string>;
export const logKinds: LogKind[] = ['workout', 'nutrition', 'hydration', 'sleep', 'recovery', 'weight', 'goal'];
export function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function offset(date = new Date()) {
  const minutes = -date.getTimezoneOffset();
  return `${minutes < 0 ? '-' : '+'}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, '0')}:${String(Math.abs(minutes) % 60).padStart(2, '0')}`;
}
export function newLogForm(): LogForm {
  return { date: localDay(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', notes: '',
    title: '', sport: 'Strength', durationMinutes: '', distance: '', linkedWhoopWorkoutId: '',
    meal: '', calories: '', proteinGrams: '', carbohydrateGrams: '', fatGrams: '', amount: '',
    startDate: localDay(new Date(Date.now() - 86400000)), startTime: '22:00', startOffset: offset(),
    endDate: localDay(), endTime: '07:00', endOffset: offset(), nap: 'no', quality: '5',
    energy: '5', soreness: '5', stress: '5', mood: '5', tags: '', weight: '',
    metric: 'workouts_per_week', target: '',
  };
}
function number(value: string | undefined, label: string) {
  if (!value?.trim()) throw new Error(`${label} is required.`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a number.`);
  return parsed;
}
function time(form: LogForm, prefix: 'start' | 'end') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form[prefix + 'Date']) || !/^\d{2}:\d{2}$/.test(form[prefix + 'Time'])
    || !/^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(form[prefix + 'Offset'])) throw new Error('Enter valid sleep dates, times, and UTC offsets.');
  const value = `${form[prefix + 'Date']}T${form[prefix + 'Time']}:00${form[prefix + 'Offset']}`;
  if (!Number.isFinite(Date.parse(value))) throw new Error('Sleep time is invalid.');
  return value;
}
export function formEntry(kind: LogKind, form: LogForm, exercises: ExerciseForm[], imperial: boolean): HealthLogInput {
  const n = (key: string) => number(form[key], key.replace(/([A-Z])/g, ' $1'));
  let details: unknown;
  switch (kind) {
    case 'workout': details = { title: form.title, sport: form.sport, durationMinutes: n('durationMinutes'),
      ...(form.distance.trim() ? { distanceKm: n('distance') * (imperial ? 1.609344 : 1) } : {}),
      linkedWhoopWorkoutId: form.linkedWhoopWorkoutId || null,
      exercises: exercises.map((exercise) => ({ name: exercise.name, sets: exercise.sets.map((set) => ({
        reps: number(set.reps, 'Reps'), weightKg: number(set.weight, 'Weight') * (imperial ? 0.45359237 : 1),
      })) })),
    }; break;
    case 'nutrition': details = { meal: form.meal, calories: n('calories'), proteinGrams: n('proteinGrams'), carbohydrateGrams: n('carbohydrateGrams'), fatGrams: n('fatGrams') }; break;
    case 'hydration': details = { milliliters: n('amount') * (imperial ? 29.5735295625 : 1) }; break;
    case 'sleep': details = { start: time(form, 'start'), end: time(form, 'end'), nap: form.nap === 'yes', quality: n('quality') }; break;
    case 'recovery': details = { energy: n('energy'), soreness: n('soreness'), stress: n('stress'), mood: n('mood'), tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean) }; break;
    case 'weight': details = { kilograms: n('weight') * (imperial ? 0.45359237 : 1) }; break;
    case 'goal': details = { metric: form.metric, target: n('target') }; break;
  }
  return healthLogInputSchema.parse({ kind, date: form.date, timezone: form.timezone, notes: form.notes, details });
}
const decimal = (value: number) => String(Number(value.toFixed(4)));
export function entryForm(entry: HealthLogInput, imperial: boolean) {
  const form: LogForm = { ...newLogForm(), date: entry.date, timezone: entry.timezone, notes: entry.notes };
  let exercises: ExerciseForm[] = [];
  const details = entry.details;
  for (const [key, value] of Object.entries(details)) if (typeof value === 'string' || typeof value === 'number') form[key] = String(value);
  if (entry.kind === 'workout') {
    form.distance = entry.details.distanceKm === undefined ? '' : decimal(entry.details.distanceKm / (imperial ? 1.609344 : 1));
    form.linkedWhoopWorkoutId = entry.details.linkedWhoopWorkoutId ?? '';
    exercises = entry.details.exercises.map((exercise) => ({ name: exercise.name,
      sets: exercise.sets.map((set) => ({ reps: String(set.reps), weight: decimal(set.weightKg / (imperial ? 0.45359237 : 1)) })) }));
  }
  if (entry.kind === 'hydration') form.amount = decimal(entry.details.milliliters / (imperial ? 29.5735295625 : 1));
  if (entry.kind === 'weight') form.weight = decimal(entry.details.kilograms / (imperial ? 0.45359237 : 1));
  if (entry.kind === 'recovery') form.tags = entry.details.tags.join(', ');
  if (entry.kind === 'sleep') {
    for (const prefix of ['start', 'end'] as const) {
      const value = entry.details[prefix];
      form[prefix + 'Date'] = value.slice(0, 10); form[prefix + 'Time'] = value.slice(11, 16);
      form[prefix + 'Offset'] = value.endsWith('Z') ? '+00:00' : value.slice(-6);
    }
    form.nap = entry.details.nap ? 'yes' : 'no';
  }
  return { form, exercises };
}
export function entrySummary(entry: HealthLogInput) {
  switch (entry.kind) {
    case 'workout': return `${entry.details.title} - ${entry.details.durationMinutes} min${entry.details.linkedWhoopWorkoutId ? ' (linked to WHOOP)' : ''}`;
    case 'nutrition': return `${entry.details.meal} - ${entry.details.calories} kcal; P ${entry.details.proteinGrams}g / C ${entry.details.carbohydrateGrams}g / F ${entry.details.fatGrams}g`;
    case 'hydration': return `${Math.round(entry.details.milliliters)} mL`;
    case 'weight': return `${decimal(entry.details.kilograms)} kg`;
    case 'sleep': return `${((Date.parse(entry.details.end) - Date.parse(entry.details.start)) / 3600000).toFixed(1)} hours${entry.details.nap ? ' nap' : ''}; quality ${entry.details.quality}/10`;
    case 'recovery': return `Energy ${entry.details.energy}, soreness ${entry.details.soreness}, stress ${entry.details.stress}, mood ${entry.details.mood} (1-10)`;
    case 'goal': return `${entry.details.metric.replaceAll('_', ' ')}: ${entry.details.target}`;
  }
}
