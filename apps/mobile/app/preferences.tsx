import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { NotificationDevice, Preferences } from '@3plates/contract';

import {
  ApiRequestError,
  clearSession,
  fetchPreferences,
  flushPendingMutations,
  getPendingMutationCount,
  registerDevice,
  signOutAndClearSession,
  updatePreferences,
} from '../src/lib/api';
import {
  getRuntimeNotificationPlatform,
  requestNotificationDeviceRegistration,
} from '../src/lib/notification-registration';
import { useRequireSession } from '../src/lib/use-require-session';

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
  const router = useRouter();
  const sessionReady = useRequireSession();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [theme, setTheme] = useState<Preferences['theme']>('system');
  const [units, setUnits] = useState<Preferences['units']>('metric');
  const [reminderTime, setReminderTime] = useState('07:00');
  const [platform, setPlatform] = useState<NotificationDevice['platform']>(
    getRuntimeNotificationPlatform(),
  );
  const [pushToken, setPushToken] = useState('');
  const [source, setSource] = useState<'network' | 'cache' | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleInvalidAuth = async (loadError: unknown) => {
    if (loadError instanceof ApiRequestError && loadError.code === 'invalid_auth') {
      await clearSession();
      router.replace('/sign-in');
      return true;
    }

    return false;
  };

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
      if (await handleInvalidAuth(loadError)) {
        return;
      }

      setError(formatError(loadError));
      setStatus('error');
    }
  };

  useEffect(() => {
    if (sessionReady) {
      void loadPreferences();
    }
  }, [sessionReady]);

  const withBusy = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    setError(null);

    try {
      await action();
      setPendingCount(await getPendingMutationCount());
    } catch (actionError) {
      if (await handleInvalidAuth(actionError)) {
        return;
      }

      setError(formatError(actionError));
    } finally {
      setBusy(false);
    }
  };

  const registerResolvedDevice = async (device: NotificationDevice) => {
    setPlatform(device.platform);
    setPushToken(device.pushToken);

    const result = await registerDevice(device);
    setMessage(
      result.queued
        ? 'Offline: device registration queued.'
        : 'Device registered on backend.',
    );
  };

  if (!sessionReady) {
    return <View style={styles.blank} />;
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.page}>
      <Text style={styles.title}>Settings</Text>

      {status === 'loading' ? <Text style={styles.meta}>Loading settings...</Text> : null}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Preferences</Text>

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

        <Text style={styles.label}>Reminder time</Text>
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
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Notifications</Text>

        <Text style={styles.label}>Platform</Text>
        <View style={styles.row}>
          {(['ios', 'android', 'web'] as NotificationDevice['platform'][]).map((candidate) => (
            <Pressable
              key={candidate}
              style={[
                styles.choice,
                platform === candidate ? styles.choiceActive : null,
                busy ? styles.buttonDisabled : null,
              ]}
              onPress={() => setPlatform(candidate)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityState={{ selected: platform === candidate, disabled: busy }}
            >
              <Text style={[styles.choiceText, platform === candidate ? styles.choiceTextActive : null]}>
                {candidate}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Push token</Text>
        <TextInput
          style={styles.input}
          accessibilityLabel="Push token"
          autoCapitalize="none"
          placeholder="ExponentPushToken[...]"
          returnKeyType="done"
          value={pushToken}
          onChangeText={setPushToken}
          editable={!busy}
        />

        <View style={styles.row}>
          <Pressable
            style={[styles.button, busy ? styles.buttonDisabled : null]}
            disabled={busy}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            onPress={() => {
              void withBusy(async () => {
                const result = await requestNotificationDeviceRegistration();

                if (result.status !== 'ready') {
                  setPlatform(result.platform);
                  setMessage(result.message);
                  return;
                }

                await registerResolvedDevice(result.device);
              });
            }}
          >
            <Text style={styles.buttonText}>Use this device</Text>
          </Pressable>

          <Pressable
            style={[
              styles.buttonSecondary,
              busy || pushToken.trim().length === 0 ? styles.buttonDisabled : null,
            ]}
            disabled={busy || pushToken.trim().length === 0}
            accessibilityRole="button"
            accessibilityState={{
              disabled: busy || pushToken.trim().length === 0,
            }}
            onPress={() => {
              void withBusy(async () => {
                await registerResolvedDevice({
                  platform,
                  pushToken: pushToken.trim(),
                });
              });
            }}
          >
            <Text style={styles.buttonSecondaryText}>Save token</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.row}>
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

        <Pressable
          style={[styles.dangerButton, busy ? styles.buttonDisabled : null]}
          disabled={busy}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          onPress={() => {
            void withBusy(async () => {
              await signOutAndClearSession();
              router.replace('/sign-in');
            });
          }}
        >
          <Text style={styles.dangerButtonText}>Sign out</Text>
        </Pressable>
      </View>

      <Text style={styles.meta}>Source: {source ?? 'unknown'}</Text>
      <Text style={styles.meta}>Pending offline updates: {pendingCount}</Text>

      {message ? <Text style={styles.success}>{message}</Text> : null}
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
  sectionTitle: {
    color: '#17202a',
    fontWeight: '800',
    fontSize: 16,
  },
  label: {
    color: '#2d3742',
    fontWeight: '700',
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  choice: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cfd6df',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  choiceActive: {
    borderColor: '#17202a',
    backgroundColor: '#17202a',
  },
  choiceText: {
    color: '#2d3742',
    fontWeight: '600',
  },
  choiceTextActive: {
    color: '#ffffff',
  },
  input: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cfd6df',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#17202a',
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
  dangerButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#b42318',
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  dangerButtonText: {
    color: '#b42318',
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
});
