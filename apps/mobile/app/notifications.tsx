import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { NotificationDevice, User } from '@3plates/contract';

import {
  ApiRequestError,
  fetchMe,
  flushPendingMutations,
  getPendingMutationCount,
  registerDevice,
} from '../src/lib/api';
import {
  getRuntimeNotificationPlatform,
  requestNotificationDeviceRegistration,
} from '../src/lib/notification-registration';

function formatError(error: unknown) {
  if (error instanceof ApiRequestError) {
    return `${error.message} (${error.status})`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error.';
}

export default function NotificationsScreen() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [platform, setPlatform] = useState<NotificationDevice['platform']>(
    getRuntimeNotificationPlatform(),
  );
  const [pushToken, setPushToken] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [source, setSource] = useState<'network' | 'cache' | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadState = async () => {
    setStatus('loading');
    setMessage(null);
    setError(null);

    try {
      const [meResult, queued] = await Promise.all([
        fetchMe(),
        getPendingMutationCount(),
      ]);

      setUser(meResult.data);
      setSource(meResult.source);
      setPendingCount(queued);
      setStatus('ready');

      if (meResult.source === 'cache') {
        setMessage('Showing cached account state while offline.');
      }
    } catch (loadError) {
      setError(formatError(loadError));
      setStatus('error');
      setUser(null);
    }
  };

  useEffect(() => {
    void loadState();
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

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.page}>
      <Text style={styles.title}>Notifications</Text>
      <Text style={styles.body}>
        Register this device token with the backend and queue registration if the network is unavailable.
      </Text>

      {status === 'loading' ? <Text style={styles.meta}>Loading account state...</Text> : null}

      <View style={styles.card}>
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
            <Text style={styles.buttonSecondaryText}>Register token</Text>
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

      {user ? (
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Authenticated user</Text>
          <Text style={styles.infoBody}>ID: {user.id}</Text>
          <Text style={styles.infoBody}>Email: {user.email ?? 'none'}</Text>
        </View>
      ) : null}

      {message ? <Text style={styles.success}>{message}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={[styles.retry, busy ? styles.buttonDisabled : null]}
        disabled={busy}
        accessibilityRole="button"
        accessibilityState={{ disabled: busy }}
        onPress={() => void loadState()}
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
    backgroundColor: '#1f1a17',
    borderColor: '#1f1a17',
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
  infoCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2d4c5',
    backgroundColor: '#fff7ef',
    padding: 14,
    gap: 6,
  },
  infoTitle: {
    color: '#2f251f',
    fontWeight: '700',
  },
  infoBody: {
    color: '#4c423b',
    fontSize: 14,
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
