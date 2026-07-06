import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { WorkoutListResponse, WorkoutMode } from '@3plates/contract';

import { ApiRequestError, fetchWorkoutsByMode } from '../src/lib/api';

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
  const [mode, setMode] = useState<WorkoutMode>('active_recovery');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [source, setSource] = useState<'network' | 'cache' | null>(null);
  const [workoutList, setWorkoutList] = useState<WorkoutListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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
      setError(toMessage(loadError));
      setStatus('error');
    }
  };

  useEffect(() => {
    void loadWorkouts(mode, 1);
  }, [mode]);

  const workouts = workoutList?.workouts ?? [];
  const pagination = workoutList?.pagination ?? null;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.page}>
      <Text style={styles.title}>Workout options</Text>
      <Text style={styles.body}>
        Choose a workout mode and load the published workout list from the backend catalog.
      </Text>

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
  scroll: {
    backgroundColor: '#f6f1e8',
  },
  page: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    flexGrow: 1,
    padding: 24,
    paddingBottom: 48,
    backgroundColor: '#f6f1e8',
    gap: 12,
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: '#1f1a17',
  },
  body: {
    color: '#4c423b',
    fontSize: 16,
    lineHeight: 24,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 4,
  },
  choice: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#8b5e34',
    backgroundColor: '#fff7ef',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  choiceActive: {
    backgroundColor: '#8b5e34',
  },
  choiceLabel: {
    color: '#8b5e34',
    fontWeight: '700',
  },
  choiceLabelActive: {
    color: '#fff7ef',
  },
  meta: {
    color: '#5b4e45',
    fontSize: 13,
  },
  list: {
    gap: 10,
  },
  card: {
    backgroundColor: '#fff7ef',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2d4c5',
    padding: 14,
    gap: 6,
  },
  cardTitle: {
    color: '#1f1a17',
    fontSize: 18,
    fontWeight: '800',
  },
  cardMeta: {
    color: '#8b5e34',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  cardBody: {
    color: '#4c423b',
    lineHeight: 20,
  },
  success: {
    color: '#0a6a3c',
    fontWeight: '600',
  },
  error: {
    color: '#8a1f2d',
    fontWeight: '600',
  },
  retry: {
    alignSelf: 'flex-start',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#8b5e34',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  retryText: {
    color: '#8b5e34',
    fontWeight: '700',
  },
  paginationRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
  },
  pageButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1f1a17',
    backgroundColor: '#fff7ef',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  pageButtonText: {
    color: '#1f1a17',
    fontWeight: '700',
  },
  pageSummary: {
    color: '#2f251f',
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
