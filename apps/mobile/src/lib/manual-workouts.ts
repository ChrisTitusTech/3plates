import AsyncStorage from '@react-native-async-storage/async-storage';

export type ManualWorkoutType = 'running_walking' | 'crossfit' | 'biking';
export type ManualWorkoutScale = 'rx' | 'scaled';

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

export async function loadManualWorkoutEntries() {
  const rawValue = await AsyncStorage.getItem(manualWorkoutStorageKey);
  if (!rawValue) {
    return [];
  }

  const parsed = JSON.parse(rawValue) as ManualWorkoutEntry[];
  return Array.isArray(parsed) ? parsed : [];
}

export async function saveManualWorkoutEntries(entries: ManualWorkoutEntry[]) {
  await AsyncStorage.setItem(manualWorkoutStorageKey, JSON.stringify(entries));
}
