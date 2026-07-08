import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ManualWorkoutCreate, ManualWorkoutScale, ManualWorkoutType } from '@3plates/contract';

import {
  createManualWorkout as createRemoteManualWorkout,
  deleteManualWorkout as deleteRemoteManualWorkout,
  fetchManualWorkouts,
} from './api';

export type { ManualWorkoutScale, ManualWorkoutType };

export type ManualWorkoutForm = {
  date: string;
  distance: string;
  duration: string;
  wodName: string;
  workoutDetails: string;
  scale: ManualWorkoutScale;
  score: string;
};

export type ManualWorkoutEntry = ManualWorkoutForm & {
  id: string;
  type: ManualWorkoutType;
  createdAt: string;
};

export const manualWorkoutTypes: Array<{ value: ManualWorkoutType; label: string }> = [
  { value: 'running_walking', label: 'Running/Walking' },
  { value: 'crossfit', label: 'Crossfit' },
  { value: 'biking', label: 'Biking' },
];

const manualWorkoutStorageKey = '@3plates/manual-workouts';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function toDateInputValue(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function createManualWorkoutForm(type: ManualWorkoutType): ManualWorkoutForm {
  return {
    date: toDateInputValue(new Date()),
    distance: '',
    duration: '',
    wodName: '',
    workoutDetails: '',
    scale: type === 'crossfit' ? 'rx' : 'scaled',
    score: '',
  };
}

export function isCardioManualWorkout(type: ManualWorkoutType) {
  return type === 'running_walking' || type === 'biking';
}

export function getManualWorkoutLabel(type: ManualWorkoutType) {
  return manualWorkoutTypes.find((candidate) => candidate.value === type)?.label ?? type;
}

export function formatManualWorkoutDetails(entry: ManualWorkoutEntry) {
  if (isCardioManualWorkout(entry.type)) {
    return `${entry.distance} · ${entry.duration}`;
  }

  return `${entry.wodName} · ${entry.scale === 'rx' ? 'Rx' : 'Scaled'} · ${entry.score}`;
}

export function formatManualWorkoutLine(entry: ManualWorkoutEntry) {
  if (entry.type === 'crossfit') {
    const scaleLabel = entry.scale === 'rx' ? 'Rx' : 'Scaled';
    return `${entry.date} · ${getManualWorkoutLabel(entry.type)} · ${entry.wodName} · ${entry.workoutDetails} · ${scaleLabel} · ${entry.score}`;
  }

  return `${entry.date} · ${getManualWorkoutLabel(entry.type)} · ${formatManualWorkoutDetails(entry)}`;
}

function sortManualWorkoutEntries(entries: ManualWorkoutEntry[]) {
  return [...entries].sort((first, second) => {
    const dateCompare = second.date.localeCompare(first.date);
    if (dateCompare !== 0) {
      return dateCompare;
    }

    return second.createdAt.localeCompare(first.createdAt);
  });
}

function toManualWorkoutCreate(entry: ManualWorkoutEntry): ManualWorkoutCreate {
  return {
    type: entry.type,
    date: entry.date,
    distance: entry.distance,
    duration: entry.duration,
    wodName: entry.wodName,
    workoutDetails: entry.workoutDetails,
    scale: entry.scale,
    score: entry.score,
  };
}

function manualWorkoutContentKey(entry: ManualWorkoutEntry) {
  return JSON.stringify(toManualWorkoutCreate(entry));
}

function isManualWorkoutEntry(value: unknown): value is ManualWorkoutEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const entry = value as Partial<ManualWorkoutEntry>;
  return (
    typeof entry.id === 'string'
    && (entry.type === 'running_walking' || entry.type === 'crossfit' || entry.type === 'biking')
    && typeof entry.date === 'string'
    && typeof entry.distance === 'string'
    && typeof entry.duration === 'string'
    && typeof entry.wodName === 'string'
    && typeof entry.workoutDetails === 'string'
    && (entry.scale === 'rx' || entry.scale === 'scaled')
    && typeof entry.score === 'string'
    && typeof entry.createdAt === 'string'
  );
}

async function loadLocalManualWorkoutEntries() {
  const rawValue = await AsyncStorage.getItem(manualWorkoutStorageKey);
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isManualWorkoutEntry) : [];
  } catch {
    return [];
  }
}

async function cacheManualWorkoutEntries(entries: ManualWorkoutEntry[]) {
  try {
    await AsyncStorage.setItem(manualWorkoutStorageKey, JSON.stringify(entries));
  } catch {
    // The server is authoritative; cache failures should not block saved workouts.
  }
}

async function migrateLocalManualWorkoutEntries(
  remoteEntries: ManualWorkoutEntry[],
  localEntries: ManualWorkoutEntry[],
) {
  const remoteContentKeys = new Set(remoteEntries.map(manualWorkoutContentKey));
  const migratedEntries: ManualWorkoutEntry[] = [];

  for (const localEntry of localEntries) {
    if (uuidPattern.test(localEntry.id) || remoteContentKeys.has(manualWorkoutContentKey(localEntry))) {
      continue;
    }

    const migratedEntry = await createRemoteManualWorkout(toManualWorkoutCreate(localEntry));
    migratedEntries.push(migratedEntry);
    remoteContentKeys.add(manualWorkoutContentKey(migratedEntry));
  }

  return migratedEntries;
}

export async function loadManualWorkoutEntries() {
  const localEntries = await loadLocalManualWorkoutEntries();

  try {
    const result = await fetchManualWorkouts();
    let remoteEntries = result.data.workouts;

    if (result.source === 'network' && localEntries.length > 0) {
      const migratedEntries = await migrateLocalManualWorkoutEntries(remoteEntries, localEntries);
      remoteEntries = [...migratedEntries, ...remoteEntries];
    }

    const sortedEntries = sortManualWorkoutEntries(remoteEntries);
    await cacheManualWorkoutEntries(sortedEntries);
    return sortedEntries;
  } catch (error) {
    if (localEntries.length > 0) {
      return sortManualWorkoutEntries(localEntries);
    }

    throw error;
  }
}

export async function saveManualWorkoutEntry(entry: ManualWorkoutEntry) {
  const savedEntry = await createRemoteManualWorkout(toManualWorkoutCreate(entry));
  const localEntries = await loadLocalManualWorkoutEntries();
  const nextEntries = sortManualWorkoutEntries([
    savedEntry,
    ...localEntries.filter((localEntry) => localEntry.id !== entry.id && localEntry.id !== savedEntry.id),
  ]);

  await cacheManualWorkoutEntries(nextEntries);
  return savedEntry;
}

export async function deleteManualWorkoutEntry(entryId: string) {
  if (uuidPattern.test(entryId)) {
    await deleteRemoteManualWorkout(entryId);
  }

  const entries = await loadLocalManualWorkoutEntries();
  const nextEntries = entries.filter((entry) => entry.id !== entryId);
  await cacheManualWorkoutEntries(nextEntries);
  return nextEntries;
}
