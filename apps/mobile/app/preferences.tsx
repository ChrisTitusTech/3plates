import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { Preferences } from '@3plates/contract';

import {
  ApiRequestError,
  fetchPreferences,
  flushPendingMutations,
  getPendingMutationCount,
  updatePreferences,
} from '../src/lib/api';

function formatError(error: unknown) {
  if (error instanceof ApiRequestError) {
    return `${error.message} (${error.status})`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error.';
}

export default function PreferencesScreen() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [theme, setTheme] = useState<Preferences['theme']>('system');
  const [units, setUnits] = useState<Preferences['units']>('metric');
  const [reminderTime, setReminderTime] = useState('07:00');
  const [source, setSource] = useState<'network' | 'cache' | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPreferences = async () => {
    setStatus('loading');
    setMessage(null);
    setError(null);

    try {
      const [result, queuedCount] = await Promise.all([
        fetchPreferences(),
        getPendingMutationCount(),
      ]);

      setTheme(result.data.theme);
      setUnits(result.data.units);
      setReminderTime(result.data.reminderTime);
      setSource(result.source);
      setPendingCount(queuedCount);
      setStatus('ready');

      if (result.source === 'cache') {
        setMessage('Showing cached preferences while offline.');
      }
    } catch (loadError) {
      setError(formatError(loadError));
      setStatus('error');
    }
  };

  useEffect(() => {
    void loadPreferences();
  }, []);

  const withBusy = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    setError(null);

    try {
      await action();
      setPendingCount(await getPendingMutationCount());
    } catch (actionError) {
      setError(formatError(actionError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.page}>
      <Text style={styles.title}>Preferences</Text>
      <Text style={styles.body}>
        Keep shared user settings synced through the backend, with cache and pending updates for offline sessions.
      </Text>

      {status === 'loading' ? <Text style={styles.meta}>Loading preferences...</Text> : null}

      <View style={styles.card}>
        <Text style={styles.label}>Theme</Text>
        <View style={styles.row}>
          {(['light', 'dark', 'system'] as Preferences['theme'][]).map((candidate) => (
            <Pressable
              key={candidate}
              style={[
                styles.choice,
                theme === candidate ? styles.choiceActive : null,
                busy ? styles.buttonDisabled : null,
              ]}
              onPress={() => setTheme(candidate)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityState={{ selected: theme === candidate, disabled: busy }}
            >
              <Text style={[styles.choiceText, theme === candidate ? styles.choiceTextActive : null]}>
                {candidate}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Units</Text>
        <View style={styles.row}>
          {(['metric', 'imperial'] as Preferences['units'][]).map((candidate) => (
            <Pressable
              key={candidate}
              style={[
                styles.choice,
                units === candidate ? styles.choiceActive : null,
                busy ? styles.buttonDisabled : null,
              ]}
              onPress={() => setUnits(candidate)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityState={{ selected: units === candidate, disabled: busy }}
            >
              <Text style={[styles.choiceText, units === candidate ? styles.choiceTextActive : null]}>
                {candidate}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Reminder time (HH:MM)</Text>
        <TextInput
          style={styles.input}
          accessibilityLabel="Reminder time"
          placeholder="07:00"
          autoCapitalize="none"
          returnKeyType="done"
          value={reminderTime}
          onChangeText={setReminderTime}
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
                const nextPreferences: Preferences = {
                  theme,
                  units,
                  reminderTime,
                };
                const result = await updatePreferences(nextPreferences);
                setMessage(result.queued ? 'Offline: preference update queued.' : 'Preferences saved to backend.');
              });
            }}
          >
            <Text style={styles.buttonText}>Save preferences</Text>
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
        onPress={() => void loadPreferences()}
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
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  choice: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cdb9a4',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  choiceActive: {
    borderColor: '#1f1a17',
    backgroundColor: '#1f1a17',
  },
  choiceText: {
    color: '#2f251f',
    fontWeight: '600',
  },
  choiceTextActive: {
    color: '#fff7ef',
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cdb9a4',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#2f251f',
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
  buttonDisabled: {
    opacity: 0.5,
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
