import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { WorkoutListResponse, WorkoutMode } from '@3plates/contract';

import { ScreenHeader } from '../src/components/ScreenHeader';
import { ApiRequestError, clearSession, fetchWorkoutsByMode } from '../src/lib/api';
import {
  createManualWorkoutForm,
  formatManualWorkoutDetails,
  getManualWorkoutLabel,
  isCardioManualWorkout,
  loadManualWorkoutEntries,
  manualWorkoutTypes,
  saveManualWorkoutEntries,
} from '../src/lib/manual-workouts';
import type { ManualWorkoutEntry, ManualWorkoutForm, ManualWorkoutType } from '../src/lib/manual-workouts';
import { useRequireSession } from '../src/lib/use-require-session';

function toMessage(error: unknown) {
  if (error instanceof ApiRequestError) {
    return `${error.message} (${error.status})`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error.';
}

const modes: Array<{ value: WorkoutMode; label: string }> = [
  { value: 'active_recovery', label: 'Active recovery' },
  { value: 'strength_metcon', label: 'Strength metcon' },
];

const pageSize = 10;

export default function WorkoutsScreen() {
  const router = useRouter();
  const sessionReady = useRequireSession();
  const [mode, setMode] = useState<WorkoutMode>('active_recovery');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [source, setSource] = useState<'network' | 'cache' | null>(null);
  const [workoutList, setWorkoutList] = useState<WorkoutListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [manualType, setManualType] = useState<ManualWorkoutType>('running_walking');
  const [manualForm, setManualForm] = useState<ManualWorkoutForm>(() => createManualWorkoutForm('running_walking'));
  const [manualEntries, setManualEntries] = useState<ManualWorkoutEntry[]>([]);
  const [manualMessage, setManualMessage] = useState<string | null>(null);
  const manualEntryReady = useMemo(() => {
    const hasDate = manualForm.date.trim().length > 0;
    if (isCardioManualWorkout(manualType)) {
      return hasDate && manualForm.distance.trim().length > 0 && manualForm.duration.trim().length > 0;
    }

    return (
      hasDate
      && manualForm.wodName.trim().length > 0
      && manualForm.workoutDetails.trim().length > 0
      && manualForm.score.trim().length > 0
    );
  }, [manualForm, manualType]);

  const loadWorkouts = async (nextMode: WorkoutMode, page = 1) => {
    setStatus('loading');
    setError(null);
    setMessage(null);

    try {
      const result = await fetchWorkoutsByMode(nextMode, { page, pageSize });
      setWorkoutList(result.data);
      setSource(result.source);
      setStatus('ready');

      if (result.source === 'cache') {
        setMessage('Showing cached workouts while offline.');
      }

      if (result.data.workouts.length === 0) {
        setMessage('No workouts are published for this mode yet.');
      }
    } catch (loadError) {
      if (loadError instanceof ApiRequestError && loadError.code === 'invalid_auth') {
        await clearSession();
        router.replace('/sign-in');
        return;
      }

      setError(toMessage(loadError));
      setStatus('error');
    }
  };

  const updateManualForm = (field: keyof ManualWorkoutForm, value: string) => {
    setManualForm((current) => ({
      ...current,
      [field]: value,
    }));
    setManualMessage(null);
  };

  const selectManualType = (nextType: ManualWorkoutType) => {
    setManualType(nextType);
    setManualForm(createManualWorkoutForm(nextType));
    setManualMessage(null);
  };

  const saveManualEntry = async () => {
    if (!manualEntryReady) {
      return;
    }

    const entry: ManualWorkoutEntry = {
      ...manualForm,
      id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: manualType,
      createdAt: new Date().toISOString(),
    };
    const nextEntries = [entry, ...manualEntries].slice(0, 20);

    setManualEntries(nextEntries);
    setManualForm(createManualWorkoutForm(manualType));
    setManualMessage('Manual workout entry added.');

    try {
      await saveManualWorkoutEntries(nextEntries);
    } catch {
      setManualMessage('Manual workout entry added for this session.');
    }
  };

  useEffect(() => {
    if (sessionReady) {
      void loadWorkouts(mode, 1);
    }
  }, [mode, sessionReady]);

  useEffect(() => {
    let active = true;

    loadManualWorkoutEntries()
      .then((entries) => {
        if (!active) {
          return;
        }

        setManualEntries(entries);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  const workouts = workoutList?.workouts ?? [];
  const pagination = workoutList?.pagination ?? null;

  if (!sessionReady) {
    return <View style={styles.blank} />;
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
    >
      <ScreenHeader title="Workouts" />

      <View style={styles.manualCard}>
        <Text style={styles.sectionTitle}>Manual entry</Text>
        <View style={styles.row}>
          {manualWorkoutTypes.map((candidate) => (
            <Pressable
              key={candidate.value}
              style={[
                styles.choice,
                manualType === candidate.value ? styles.choiceActive : null,
              ]}
              onPress={() => selectManualType(candidate.value)}
              accessibilityLabel={`Select ${candidate.label} workout type`}
              accessibilityRole="button"
              accessibilityState={{ selected: manualType === candidate.value }}
            >
              <Text style={[styles.choiceLabel, manualType === candidate.value ? styles.choiceLabelActive : null]}>
                {candidate.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Date</Text>
        <TextInput
          style={styles.input}
          accessibilityLabel="Workout date"
          placeholder="2026-07-07"
          autoCapitalize="none"
          returnKeyType="done"
          value={manualForm.date}
          onChangeText={(value) => updateManualForm('date', value)}
        />

        {isCardioManualWorkout(manualType) ? (
          <>
            <Text style={styles.label}>Distance</Text>
            <TextInput
              style={styles.input}
              accessibilityLabel="Workout distance"
              placeholder="3.1 miles"
              returnKeyType="done"
              value={manualForm.distance}
              onChangeText={(value) => updateManualForm('distance', value)}
            />

            <Text style={styles.label}>Duration</Text>
            <TextInput
              style={styles.input}
              accessibilityLabel="Workout duration"
              placeholder="32:15"
              returnKeyType="done"
              value={manualForm.duration}
              onChangeText={(value) => updateManualForm('duration', value)}
            />
          </>
        ) : (
          <>
            <Text style={styles.label}>WOD name/type</Text>
            <TextInput
              style={styles.input}
              accessibilityLabel="WOD name or type"
              placeholder="Fran"
              returnKeyType="done"
              value={manualForm.wodName}
              onChangeText={(value) => updateManualForm('wodName', value)}
            />

            <Text style={styles.label}>Workout details</Text>
            <TextInput
              style={[styles.input, styles.multilineInput]}
              accessibilityLabel="Workout details"
              placeholder="21-15-9 thrusters and pull-ups"
              multiline
              textAlignVertical="top"
              value={manualForm.workoutDetails}
              onChangeText={(value) => updateManualForm('workoutDetails', value)}
            />

            <Text style={styles.label}>Rx or scaled</Text>
            <View style={styles.row}>
              {(['rx', 'scaled'] as const).map((scale) => (
                <Pressable
                  key={scale}
                  style={[
                    styles.choice,
                    manualForm.scale === scale ? styles.choiceActive : null,
                  ]}
                  onPress={() => updateManualForm('scale', scale)}
                  accessibilityLabel={`Set workout as ${scale === 'rx' ? 'Rx' : 'scaled'}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: manualForm.scale === scale }}
                >
                  <Text style={[styles.choiceLabel, manualForm.scale === scale ? styles.choiceLabelActive : null]}>
                    {scale === 'rx' ? 'Rx' : 'Scaled'}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.label}>Score</Text>
            <TextInput
              style={styles.input}
              accessibilityLabel="Workout score"
              placeholder="7:42"
              returnKeyType="done"
              value={manualForm.score}
              onChangeText={(value) => updateManualForm('score', value)}
            />
          </>
        )}

        <Pressable
          style={[styles.button, !manualEntryReady ? styles.buttonDisabled : null]}
          disabled={!manualEntryReady}
          accessibilityRole="button"
          accessibilityState={{ disabled: !manualEntryReady }}
          onPress={() => {
            void saveManualEntry();
          }}
        >
          <Text style={styles.buttonText}>Add entry</Text>
        </Pressable>
        {manualMessage ? <Text style={styles.success}>{manualMessage}</Text> : null}
      </View>

      {manualEntries.length > 0 ? (
        <View style={styles.list}>
          <Text style={styles.sectionTitle}>Recent manual entries</Text>
          {manualEntries.slice(0, 5).map((entry) => (
            <View key={entry.id} style={styles.card}>
              <Text style={styles.cardTitle}>{getManualWorkoutLabel(entry.type)}</Text>
              <Text style={styles.cardMeta}>{entry.date}</Text>
              <Text style={styles.cardBody}>{formatManualWorkoutDetails(entry)}</Text>
              {entry.type === 'crossfit' ? <Text style={styles.cardBody}>{entry.workoutDetails}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.row}>
        {modes.map((candidate) => (
          <Pressable
            key={candidate.value}
            style={[
              styles.choice,
              mode === candidate.value ? styles.choiceActive : null,
              status === 'loading' ? styles.buttonDisabled : null,
            ]}
            onPress={() => setMode(candidate.value)}
            disabled={status === 'loading'}
            accessibilityLabel={`Show ${candidate.label} workouts`}
            accessibilityRole="button"
            accessibilityState={{
              selected: mode === candidate.value,
              disabled: status === 'loading',
            }}
          >
            <Text style={[styles.choiceLabel, mode === candidate.value ? styles.choiceLabelActive : null]}>
              {candidate.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {status === 'loading' ? <Text style={styles.meta}>Loading workouts...</Text> : null}
      <Text style={styles.meta}>Source: {source ?? 'unknown'}</Text>
      {pagination ? (
        <Text style={styles.meta}>
          Showing {workouts.length} of {pagination.total} workouts
        </Text>
      ) : null}

      <View style={styles.list}>
        {workouts.map((workout) => (
          <View key={workout.id} style={styles.card}>
            <Text style={styles.cardTitle}>{workout.title}</Text>
            <Text style={styles.cardMeta}>{workout.mode === 'active_recovery' ? 'Active recovery' : 'Strength metcon'}</Text>
            {workout.description ? <Text style={styles.cardBody}>{workout.description}</Text> : null}
          </View>
        ))}
      </View>

      {message ? <Text style={styles.success}>{message}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {pagination && pagination.totalPages > 0 ? (
        <View style={styles.paginationRow}>
          <Pressable
            style={[
              styles.pageButton,
              !pagination.hasPreviousPage || status === 'loading' ? styles.buttonDisabled : null,
            ]}
            disabled={!pagination.hasPreviousPage || status === 'loading'}
            onPress={() => {
              void loadWorkouts(mode, pagination.page - 1);
            }}
            accessibilityLabel="Load previous workout page"
            accessibilityRole="button"
            accessibilityState={{
              disabled: !pagination.hasPreviousPage || status === 'loading',
            }}
          >
            <Text style={styles.pageButtonText}>Previous</Text>
          </Pressable>

          <Text style={styles.pageSummary}>
            Page {pagination.page} of {pagination.totalPages}
          </Text>

          <Pressable
            style={[
              styles.pageButton,
              !pagination.hasNextPage || status === 'loading' ? styles.buttonDisabled : null,
            ]}
            disabled={!pagination.hasNextPage || status === 'loading'}
            onPress={() => {
              void loadWorkouts(mode, pagination.page + 1);
            }}
            accessibilityLabel="Load next workout page"
            accessibilityRole="button"
            accessibilityState={{
              disabled: !pagination.hasNextPage || status === 'loading',
            }}
          >
            <Text style={styles.pageButtonText}>Next</Text>
          </Pressable>
        </View>
      ) : null}

      <Pressable
        style={styles.retry}
        disabled={status === 'loading'}
        onPress={() => {
          void loadWorkouts(mode, pagination?.page ?? 1);
        }}
        accessibilityLabel="Retry loading workouts"
        accessibilityRole="button"
        accessibilityState={{ disabled: status === 'loading' }}
      >
        <Text style={styles.retryText}>Retry load</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  blank: {
    flex: 1,
    backgroundColor: '#f7f8fa',
  },
  scroll: {
    backgroundColor: '#f7f8fa',
  },
  page: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    flexGrow: 1,
    padding: 24,
    paddingBottom: 48,
    backgroundColor: '#f7f8fa',
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 4,
  },
  choice: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#17202a',
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  choiceActive: {
    backgroundColor: '#17202a',
  },
  choiceLabel: {
    color: '#17202a',
    fontWeight: '700',
  },
  choiceLabelActive: {
    color: '#ffffff',
  },
  meta: {
    color: '#53606c',
    fontSize: 13,
  },
  manualCard: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dce3ea',
    padding: 14,
    gap: 10,
  },
  sectionTitle: {
    color: '#17202a',
    fontSize: 16,
    fontWeight: '800',
  },
  label: {
    color: '#2d3742',
    fontWeight: '700',
    fontSize: 14,
  },
  input: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cfd6df',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#ffffff',
    color: '#17202a',
  },
  multilineInput: {
    minHeight: 92,
  },
  list: {
    gap: 10,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dce3ea',
    padding: 14,
    gap: 6,
  },
  cardTitle: {
    color: '#17202a',
    fontSize: 18,
    fontWeight: '800',
  },
  cardMeta: {
    color: '#53606c',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  cardBody: {
    color: '#2d3742',
    lineHeight: 20,
  },
  success: {
    color: '#067647',
    fontWeight: '600',
  },
  error: {
    color: '#b42318',
    fontWeight: '600',
  },
  button: {
    alignSelf: 'flex-start',
    backgroundColor: '#17202a',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  retry: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#17202a',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  retryText: {
    color: '#17202a',
    fontWeight: '700',
  },
  paginationRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
  },
  pageButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#17202a',
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  pageButtonText: {
    color: '#17202a',
    fontWeight: '700',
  },
  pageSummary: {
    color: '#17202a',
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
