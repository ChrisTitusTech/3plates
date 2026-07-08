import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { Progress } from '@3plates/contract';

import { ScreenHeader } from '../src/components/ScreenHeader';
import { ApiRequestError, clearSession, fetchProgress, updateProgress } from '../src/lib/api';
import {
  deleteManualWorkoutEntry,
  formatManualWorkoutLine,
  loadManualWorkoutEntries,
} from '../src/lib/manual-workouts';
import type { ManualWorkoutEntry } from '../src/lib/manual-workouts';
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

function parseDateKeyToLocalNoon(value: string) {
  const [yearValue, monthValue, dayValue] = value.split('-').map(Number);
  if (!yearValue || !monthValue || !dayValue) {
    return null;
  }

  return new Date(yearValue, monthValue - 1, dayValue, 12);
}

function buildStreakDateKeys(lastDateKey: string | null, streakDays: number) {
  const dateKeys = new Set<string>();
  if (!lastDateKey || streakDays <= 0) {
    return dateKeys;
  }

  const lastDate = parseDateKeyToLocalNoon(lastDateKey);
  if (!lastDate) {
    return dateKeys;
  }

  for (let index = 0; index < streakDays; index += 1) {
    const streakDate = new Date(lastDate);
    streakDate.setDate(lastDate.getDate() - index);
    dateKeys.add(toLocalDateKey(streakDate));
  }

  return dateKeys;
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
  const [progress, setProgress] = useState<Progress | null>(null);
  const [manualEntries, setManualEntries] = useState<ManualWorkoutEntry[]>([]);
  const [manualHistoryLoaded, setManualHistoryLoaded] = useState(false);
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = useMemo(() => new Date(), []);
  const todayKey = useMemo(() => toLocalDateKey(today), [today]);
  const calendarDays = useMemo(() => buildCalendarDays(today), [today]);
  const checkedDateKey = useMemo(() => parseDateKey(progress?.lastWorkoutAt ?? null), [progress?.lastWorkoutAt]);
  const streakDateKeys = useMemo(
    () => buildStreakDateKeys(checkedDateKey, progress?.streakDays ?? 0),
    [checkedDateKey, progress?.streakDays],
  );
  const workoutDateKeys = useMemo(
    () => new Set(manualEntries.map((entry) => entry.date)),
    [manualEntries],
  );
  const completedWorkoutCount = manualHistoryLoaded
    ? manualEntries.length
    : progress?.completedWorkouts ?? 0;
  const monthLabel = useMemo(
    () => today.toLocaleString(undefined, { month: 'long', year: 'numeric' }),
    [today],
  );
  const checkedInToday = streakDateKeys.has(todayKey);
  const visibleManualEntries = useMemo(() => {
    const entries = selectedDateKey
      ? manualEntries.filter((entry) => entry.date === selectedDateKey)
      : manualEntries;

    return [...entries].sort((first, second) => {
      const dateCompare = second.date.localeCompare(first.date);
      if (dateCompare !== 0) {
        return dateCompare;
      }

      return second.createdAt.localeCompare(first.createdAt);
    });
  }, [manualEntries, selectedDateKey]);

  const loadProgress = async () => {
    setStatus('loading');
    setError(null);

    try {
      const result = await fetchProgress();
      let nextProgress = result.data;
      const currentCheckInDate = parseDateKey(nextProgress.lastWorkoutAt);

      if (currentCheckInDate !== todayKey) {
        nextProgress = {
          ...nextProgress,
          lastWorkoutAt: new Date().toISOString(),
        };

        await updateProgress(nextProgress);
      }

      setProgress(nextProgress);
      setStatus('ready');
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

  const loadWorkoutHistory = useCallback(async () => {
    try {
      setManualEntries(await loadManualWorkoutEntries());
      setManualHistoryLoaded(true);
    } catch {
      setManualEntries([]);
      setManualHistoryLoaded(false);
    }
  }, []);

  const deleteManualEntry = useCallback(async (entryId: string) => {
    const existingEntries = manualEntries;

    setError(null);
    setManualEntries((entries) => entries.filter((entry) => entry.id !== entryId));

    try {
      setManualEntries(await deleteManualWorkoutEntry(entryId));
    } catch {
      setManualEntries(existingEntries);
      setError('Could not delete manual workout entry.');
    }
  }, [manualEntries]);

  useEffect(() => {
    if (sessionReady) {
      void loadProgress();
    }
  }, [sessionReady]);

  useFocusEffect(
    useCallback(() => {
      if (sessionReady) {
        void loadWorkoutHistory();
      }
    }, [loadWorkoutHistory, sessionReady]),
  );

  if (!sessionReady) {
    return <View style={styles.blank} />;
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.page}>
      <ScreenHeader title="Progress" />

      {status === 'loading' ? <Text style={styles.meta}>Loading progress...</Text> : null}

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{progress?.streakDays ?? 0}</Text>
          <Text style={styles.statLabel}>Day streak</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{completedWorkoutCount}</Text>
          <Text style={styles.statLabel}>Completed workouts</Text>
        </View>
      </View>

      <View style={styles.calendarCard}>
        <View style={styles.calendarHeader}>
          <Text style={styles.sectionTitle}>{monthLabel}</Text>
          {checkedInToday ? <Text style={styles.checkedLabel}>Checked in today</Text> : null}
        </View>
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
            const isChecked = streakDateKeys.has(dateKey) || workoutDateKeys.has(dateKey);

            return (
              <Pressable
                key={dateKey}
                style={[
                  styles.calendarDay,
                  isToday ? styles.todayDay : null,
                  isChecked ? styles.checkedDay : null,
                  selectedDateKey === dateKey ? styles.selectedDay : null,
                ]}
                accessibilityLabel={`Filter workout history to ${dateKey}`}
                accessibilityRole="button"
                accessibilityState={{ selected: selectedDateKey === dateKey }}
                onPress={() => {
                  setSelectedDateKey((currentDateKey) => (
                    currentDateKey === dateKey ? null : dateKey
                  ));
                }}
              >
                <Text
                  style={[
                    styles.dayNumber,
                    isChecked ? styles.checkedDayText : null,
                    selectedDateKey === dateKey ? styles.selectedDayText : null,
                  ]}
                >
                  {day}
                </Text>
                {isChecked ? <Text style={styles.checkMark}>✓</Text> : null}
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.historyCard}>
        <View style={styles.historyHeader}>
          <Text style={styles.sectionTitle}>Workout history</Text>
          {selectedDateKey ? (
            <Pressable
              style={styles.clearFilterButton}
              accessibilityLabel="Show all workout history"
              accessibilityRole="button"
              onPress={() => setSelectedDateKey(null)}
            >
              <Text style={styles.clearFilterText}>All days</Text>
            </Pressable>
          ) : null}
        </View>
        {selectedDateKey ? <Text style={styles.meta}>{selectedDateKey}</Text> : null}
        {visibleManualEntries.length > 0 ? (
          <View style={styles.historyList}>
            {visibleManualEntries.map((entry) => (
              <View key={entry.id} style={styles.historyRow}>
                <Text
                  style={styles.historyLine}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {formatManualWorkoutLine(entry)}
                </Text>
                <Pressable
                  style={styles.deleteButton}
                  accessibilityLabel={`Delete manual workout from ${entry.date}`}
                  accessibilityRole="button"
                  onPress={() => {
                    void deleteManualEntry(entry.id);
                  }}
                >
                  <Text style={styles.deleteButtonText}>Delete</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.meta}>
            {selectedDateKey ? 'No workouts logged for this day.' : 'No workouts logged yet.'}
          </Text>
        )}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
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
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statCard: {
    flexGrow: 1,
    minWidth: 180,
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dce3ea',
    padding: 14,
    gap: 4,
  },
  statValue: {
    color: '#17202a',
    fontSize: 28,
    fontWeight: '800',
  },
  statLabel: {
    color: '#53606c',
    fontSize: 13,
    fontWeight: '700',
  },
  calendarCard: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dce3ea',
    padding: 14,
    gap: 10,
  },
  calendarHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sectionTitle: {
    color: '#17202a',
    fontSize: 16,
    fontWeight: '800',
  },
  checkedLabel: {
    color: '#067647',
    fontSize: 13,
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
  selectedDay: {
    borderColor: '#17202a',
    borderWidth: 2,
  },
  dayNumber: {
    color: '#17202a',
    fontSize: 13,
    fontWeight: '700',
  },
  checkedDayText: {
    color: '#ffffff',
  },
  selectedDayText: {
    fontWeight: '900',
  },
  checkMark: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 18,
  },
  meta: {
    color: '#53606c',
    fontSize: 13,
  },
  historyCard: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dce3ea',
    padding: 14,
    gap: 10,
  },
  historyHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  historyList: {
    gap: 6,
  },
  historyRow: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  historyLine: {
    flex: 1,
    color: '#17202a',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  deleteButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#b42318',
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  deleteButtonText: {
    color: '#b42318',
    fontSize: 13,
    fontWeight: '800',
  },
  clearFilterButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#17202a',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  clearFilterText: {
    color: '#17202a',
    fontSize: 13,
    fontWeight: '800',
  },
  error: {
    color: '#b42318',
    fontWeight: '600',
  },
});
