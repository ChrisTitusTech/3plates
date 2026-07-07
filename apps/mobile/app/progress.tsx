import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { Progress } from '@3plates/contract';

import { SettingsCog } from '../src/components/SettingsCog';
import { ApiRequestError, clearSession, fetchProgress, flushPendingMutations, getPendingMutationCount, updateProgress } from '../src/lib/api';
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

function sanitizeInteger(value: string) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

function toLocalDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateKey(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return toLocalDateKey(parsed);
}

function buildCalendarDays(monthDate: Date) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingEmptyDays = firstDay.getDay();
  const days: Array<number | null> = [];

  for (let index = 0; index < leadingEmptyDays; index += 1) {
    days.push(null);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    days.push(day);
  }

  while (days.length % 7 !== 0) {
    days.push(null);
  }

  return days;
}

export default function ProgressScreen() {
  const router = useRouter();
  const sessionReady = useRequireSession();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [streakDays, setStreakDays] = useState('0');
  const [completedWorkouts, setCompletedWorkouts] = useState('0');
  const [lastWorkoutAt, setLastWorkoutAt] = useState('');
  const [source, setSource] = useState<'network' | 'cache' | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = useMemo(() => new Date(), []);
  const todayKey = useMemo(() => toLocalDateKey(today), [today]);
  const calendarDays = useMemo(() => buildCalendarDays(today), [today]);
  const checkedDateKey = useMemo(() => parseDateKey(lastWorkoutAt), [lastWorkoutAt]);
  const monthLabel = useMemo(
    () => today.toLocaleString(undefined, { month: 'long', year: 'numeric' }),
    [today],
  );

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
      const [result, initialQueueCount] = await Promise.all([
        fetchProgress(),
        getPendingMutationCount(),
      ]);
      const currentCheckInDate = parseDateKey(result.data.lastWorkoutAt);
      let nextProgress = result.data;
      let queueCount = initialQueueCount;
      let nextMessage = result.source === 'cache' ? 'Showing cached progress while offline.' : null;

      if (currentCheckInDate !== todayKey) {
        const checkedInAt = new Date().toISOString();
        nextProgress = {
          ...nextProgress,
          lastWorkoutAt: checkedInAt,
        };

        const updateResult = await updateProgress(nextProgress);
        queueCount = await getPendingMutationCount();
        nextMessage = updateResult.queued
          ? 'Today is checked off and will sync when you are back online.'
          : 'Today is checked off.';
      }

      setStreakDays(String(nextProgress.streakDays));
      setCompletedWorkouts(String(nextProgress.completedWorkouts));
      setLastWorkoutAt(nextProgress.lastWorkoutAt ?? '');
      setSource(result.source);
      setPendingCount(queueCount);
      setStatus('ready');
      setMessage(nextMessage);
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
      void loadProgress();
    }
  }, [sessionReady]);

  const withBusy = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      setPendingCount(await getPendingMutationCount());
    } catch (actionError) {
      if (actionError instanceof ApiRequestError && actionError.code === 'invalid_auth') {
        await clearSession();
        router.replace('/sign-in');
        return;
      }

      setError(toMessage(actionError));
    } finally {
      setBusy(false);
    }
  };

  if (!sessionReady) {
    return <View style={styles.blank} />;
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.page}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Progress</Text>
        <SettingsCog />
      </View>

      {status === 'loading' ? <Text style={styles.meta}>Loading progress...</Text> : null}

      <View style={styles.calendarCard}>
        <Text style={styles.sectionTitle}>{monthLabel}</Text>
        <View style={styles.weekRow}>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((dayLabel) => (
            <Text key={dayLabel} style={styles.weekday}>{dayLabel}</Text>
          ))}
        </View>
        <View style={styles.calendarGrid}>
          {calendarDays.map((day, index) => {
            if (day === null) {
              return <View key={`empty-${index}`} style={styles.calendarDay} />;
            }

            const dateKey = toLocalDateKey(new Date(today.getFullYear(), today.getMonth(), day));
            const isToday = dateKey === todayKey;
            const isChecked = dateKey === checkedDateKey;

            return (
              <View
                key={dateKey}
                style={[
                  styles.calendarDay,
                  isToday ? styles.todayDay : null,
                  isChecked ? styles.checkedDay : null,
                ]}
              >
                <Text style={[styles.dayNumber, isChecked ? styles.checkedDayText : null]}>
                  {day}
                </Text>
                {isChecked ? <Text style={styles.checkMark}>✓</Text> : null}
              </View>
            );
          })}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Streak days</Text>
        <TextInput
          style={styles.input}
          accessibilityLabel="Streak days"
          keyboardType="number-pad"
          returnKeyType="done"
          value={streakDays}
          onChangeText={setStreakDays}
          editable={!busy}
        />

        <Text style={styles.label}>Completed workouts</Text>
        <TextInput
          style={styles.input}
          accessibilityLabel="Completed workouts"
          keyboardType="number-pad"
          returnKeyType="done"
          value={completedWorkouts}
          onChangeText={setCompletedWorkouts}
          editable={!busy}
        />

        <Text style={styles.label}>Last workout at (ISO datetime)</Text>
        <TextInput
          style={styles.input}
          accessibilityLabel="Last workout at ISO datetime"
          placeholder="2026-05-10T18:30:00.000Z"
          autoCapitalize="none"
          returnKeyType="done"
          value={lastWorkoutAt}
          onChangeText={setLastWorkoutAt}
          editable={!busy}
        />

        <View style={styles.row}>
          <Pressable
            style={[styles.button, busy || status === 'loading' ? styles.buttonDisabled : null]}
            disabled={busy || status === 'loading'}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy || status === 'loading' }}
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
            style={[styles.buttonSecondary, busy ? styles.buttonDisabled : null]}
            disabled={busy}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
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

      <Pressable
        style={[styles.retry, busy ? styles.buttonDisabled : null]}
        disabled={busy}
        accessibilityRole="button"
        accessibilityState={{ disabled: busy }}
        onPress={() => void loadProgress()}
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
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dce3ea',
    padding: 14,
    gap: 10,
  },
  calendarCard: {
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
  weekRow: {
    flexDirection: 'row',
    gap: 4,
  },
  weekday: {
    flex: 1,
    color: '#53606c',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  calendarDay: {
    width: '13.75%',
    aspectRatio: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e8edf2',
    backgroundColor: '#f7f8fa',
  },
  todayDay: {
    borderColor: '#17202a',
  },
  checkedDay: {
    borderColor: '#067647',
    backgroundColor: '#067647',
  },
  dayNumber: {
    color: '#17202a',
    fontSize: 13,
    fontWeight: '700',
  },
  checkedDayText: {
    color: '#ffffff',
  },
  checkMark: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 18,
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
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  button: {
    backgroundColor: '#17202a',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  buttonText: {
    color: '#fff7ef',
    fontWeight: '700',
  },
  buttonSecondary: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#17202a',
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  buttonSecondaryText: {
    color: '#17202a',
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  meta: {
    color: '#53606c',
    fontSize: 13,
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
});
