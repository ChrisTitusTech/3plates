import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { WorkoutListResponse, WorkoutMode } from '@3plates/contract';

import { SettingsCog } from '../src/components/SettingsCog';
import { ApiRequestError, clearSession, fetchWorkoutsByMode } from '../src/lib/api';
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

  useEffect(() => {
    if (sessionReady) {
      void loadWorkouts(mode, 1);
    }
  }, [mode, sessionReady]);

  const workouts = workoutList?.workouts ?? [];
  const pagination = workoutList?.pagination ?? null;

  if (!sessionReady) {
    return <View style={styles.blank} />;
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.page}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Workouts</Text>
        <SettingsCog />
      </View>

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
  headerRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: '#17202a',
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
