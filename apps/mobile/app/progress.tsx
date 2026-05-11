import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { Progress } from '@3plates/contract';

import { ApiRequestError, fetchProgress, flushPendingMutations, getPendingMutationCount, updateProgress } from '../src/lib/api';

function toMessage(error: unknown) {
  if (error instanceof ApiRequestError) {
    return `${error.message} (${error.status})`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error.';
}

function sanitizeInteger(value: string) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

export default function ProgressScreen() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [streakDays, setStreakDays] = useState('0');
  const [completedWorkouts, setCompletedWorkouts] = useState('0');
  const [lastWorkoutAt, setLastWorkoutAt] = useState('');
  const [source, setSource] = useState<'network' | 'cache' | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const progressPayload = useMemo<Progress>(() => {
    const isoText = lastWorkoutAt.trim();
    return {
      streakDays: sanitizeInteger(streakDays),
      completedWorkouts: sanitizeInteger(completedWorkouts),
      lastWorkoutAt: isoText.length > 0 ? isoText : null,
    };
  }, [completedWorkouts, lastWorkoutAt, streakDays]);

  const loadProgress = async () => {
    setStatus('loading');
    setError(null);
    setMessage(null);

    try {
      const [result, queueCount] = await Promise.all([
        fetchProgress(),
        getPendingMutationCount(),
      ]);

      setStreakDays(String(result.data.streakDays));
      setCompletedWorkouts(String(result.data.completedWorkouts));
      setLastWorkoutAt(result.data.lastWorkoutAt ?? '');
      setSource(result.source);
      setPendingCount(queueCount);
      setStatus('ready');
      if (result.source === 'cache') {
        setMessage('Showing cached progress while offline.');
      }
    } catch (loadError) {
      setError(toMessage(loadError));
      setStatus('error');
    }
  };

  useEffect(() => {
    void loadProgress();
  }, []);

  const withBusy = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      setPendingCount(await getPendingMutationCount());
    } catch (actionError) {
      setError(toMessage(actionError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.title}>Progress</Text>
      <Text style={styles.body}>
        Read and update progress against the backend, with cached fallback and queued offline writes.
      </Text>

      {status === 'loading' ? <Text style={styles.meta}>Loading progress...</Text> : null}

      <View style={styles.card}>
        <Text style={styles.label}>Streak days</Text>
        <TextInput
          style={styles.input}
          keyboardType="number-pad"
          value={streakDays}
          onChangeText={setStreakDays}
          editable={!busy}
        />

        <Text style={styles.label}>Completed workouts</Text>
        <TextInput
          style={styles.input}
          keyboardType="number-pad"
          value={completedWorkouts}
          onChangeText={setCompletedWorkouts}
          editable={!busy}
        />

        <Text style={styles.label}>Last workout at (ISO datetime)</Text>
        <TextInput
          style={styles.input}
          placeholder="2026-05-10T18:30:00.000Z"
          autoCapitalize="none"
          value={lastWorkoutAt}
          onChangeText={setLastWorkoutAt}
          editable={!busy}
        />

        <View style={styles.row}>
          <Pressable
            style={styles.button}
            disabled={busy || status === 'loading'}
            onPress={() => {
              void withBusy(async () => {
                const result = await updateProgress(progressPayload);
                setMessage(result.queued ? 'Offline: update queued for retry.' : 'Progress updated on backend.');
              });
            }}
          >
            <Text style={styles.buttonText}>Save progress</Text>
          </Pressable>
          <Pressable
            style={styles.buttonSecondary}
            disabled={busy}
            onPress={() => {
              void withBusy(async () => {
                const flushed = await flushPendingMutations();
                setMessage(`Retried pending updates. Flushed ${flushed.flushed}, remaining ${flushed.remaining}.`);
              });
            }}
          >
            <Text style={styles.buttonSecondaryText}>Retry pending</Text>
          </Pressable>
        </View>
      </View>

      <Text style={styles.meta}>Source: {source ?? 'unknown'}</Text>
      <Text style={styles.meta}>Pending offline updates: {pendingCount}</Text>

      {message ? <Text style={styles.success}>{message}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable style={styles.retry} disabled={busy} onPress={() => void loadProgress()}>
        <Text style={styles.retryText}>Retry load</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
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
  card: {
    backgroundColor: '#fff7ef',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2d4c5',
    padding: 14,
    gap: 10,
  },
  label: {
    color: '#2f251f',
    fontWeight: '700',
    fontSize: 14,
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cdb9a4',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#ffffff',
    color: '#2f251f',
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  button: {
    backgroundColor: '#1f1a17',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  buttonText: {
    color: '#fff7ef',
    fontWeight: '700',
  },
  buttonSecondary: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1f1a17',
    backgroundColor: '#fff7ef',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  buttonSecondaryText: {
    color: '#1f1a17',
    fontWeight: '700',
  },
  meta: {
    color: '#5b4e45',
    fontSize: 13,
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
});
