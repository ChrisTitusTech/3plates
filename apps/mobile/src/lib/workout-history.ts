import type { HealthLog } from '@3plates/contract';
import type { Dashboard } from '@3plates/whoop/types';

// A link only suppresses an additional count when that imported workout is
// actually present. Deleted/unavailable imports still leave the manual entry.
export function workoutCount(logs: HealthLog[], details: Dashboard['details']) {
  const imported = details.filter((d) => d.kind === 'workout');
  const ids = new Set(imported.map((d) => d.sourceId).filter(Boolean));
  const linked = new Set<string>();
  let count = imported.length;
  for (const log of logs) {
    if (log.entry?.kind !== 'workout') continue;
    const id = log.entry.details.linkedWhoopWorkoutId;
    if (id && (ids.has(id) || linked.has(id))) continue;
    if (id) linked.add(id);
    count++;
  }
  return count;
}
