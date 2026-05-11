import { useEffect, useRef, useState } from 'react';
import * as ExpoLinking from 'expo-linking';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { AuthProvider, User } from '@3plates/contract';

import {
  ApiRequestError,
  clearSession,
  fetchMe,
  getPendingMutationCount,
  getSessionToken,
  redeemMobileAuthExchangeCode,
  refreshSessionAndPersist,
  setSessionToken,
  startAuth,
} from '../src/lib/api';

function formatError(error: unknown) {
  if (error instanceof ApiRequestError) {
    return `${error.message} (${error.status})`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Something went wrong.';
}

export default function SignInScreen() {
  const [provider, setProvider] = useState<AuthProvider>('google');
  const [tokenInput, setTokenInput] = useState('');
  const [activeToken, setActiveToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingMutations, setPendingMutations] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const handledDeepLinkRef = useRef<string | null>(null);

  const mobileRedirectUrl = ExpoLinking.createURL('auth/callback');

  const loadSession = async () => {
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      const token = await getSessionToken();
      setActiveToken(token);
      setTokenInput(token ?? '');
      setPendingMutations(await getPendingMutationCount());

      if (!token) {
        setCurrentUser(null);
        return;
      }

      const meResult = await fetchMe();
      setCurrentUser(meResult.data);
      if (meResult.source === 'cache') {
        setMessage('Loaded account from cache while offline.');
      }
    } catch (loadError) {
      setCurrentUser(null);
      setError(formatError(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSession();
  }, []);

  useEffect(() => {
    let active = true;

    const handleDeepLink = async (url: string) => {
      if (!active || handledDeepLinkRef.current === url) {
        return;
      }

      const parsed = ExpoLinking.parse(url);
      const callbackPath = typeof parsed.path === 'string' ? parsed.path : null;
      if (callbackPath !== 'auth/callback') {
        return;
      }

      const queryParams = parsed.queryParams ?? {};
      const redirectedProvider = typeof queryParams.provider === 'string' ? queryParams.provider : null;
      const exchangeCode = typeof queryParams.exchangeCode === 'string' ? queryParams.exchangeCode : null;
      if (!exchangeCode) {
        return;
      }

      handledDeepLinkRef.current = url;

      if (redirectedProvider === 'google' || redirectedProvider === 'apple') {
        setProvider(redirectedProvider);
      }

      setBusy(true);
      setError(null);
      setMessage(null);

      try {
        const exchangeResult = await redeemMobileAuthExchangeCode(exchangeCode);
        setActiveToken(exchangeResult.sessionToken);
        setTokenInput(exchangeResult.sessionToken);

        const meResult = await fetchMe();
        setCurrentUser(meResult.data);
        setPendingMutations(await getPendingMutationCount());
        setMessage(
          meResult.source === 'cache'
            ? 'Sign-in completed from deep link using cached account data.'
            : 'Sign-in completed from deep link.',
        );
      } catch (deepLinkError) {
        setError(formatError(deepLinkError));
      } finally {
        setBusy(false);
      }
    };

    const subscription = Linking.addEventListener('url', (event) => {
      void handleDeepLink(event.url);
    });

    void Linking.getInitialURL().then((initialUrl) => {
      if (initialUrl) {
        void handleDeepLink(initialUrl);
      }
    });

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  const runBusyAction = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      await action();
      setPendingMutations(await getPendingMutationCount());
    } catch (actionError) {
      setError(formatError(actionError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.title}>Sign in and session management</Text>
      <Text style={styles.body}>
        Start OAuth from mobile and complete callback automatically through deep links,
        then keep session token state in local storage for API calls.
      </Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Provider</Text>
        <View style={styles.row}>
          {(['google', 'apple'] as AuthProvider[]).map((candidate) => (
            <Pressable
              key={candidate}
              style={[styles.choice, provider === candidate ? styles.choiceActive : null]}
              onPress={() => setProvider(candidate)}
              disabled={busy}
            >
              <Text
                style={[
                  styles.choiceLabel,
                  provider === candidate ? styles.choiceLabelActive : null,
                ]}
              >
                {candidate}
              </Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          style={styles.button}
          disabled={busy}
          onPress={() => {
            void runBusyAction(async () => {
              const started = await startAuth(provider, mobileRedirectUrl);
              setMessage('OAuth started. Complete sign-in in the browser and return to the app.');
              await Linking.openURL(started.next);
            });
          }}
        >
          <Text style={styles.buttonText}>Start OAuth</Text>
        </Pressable>
        <Text style={styles.meta}>Redirect URI: {mobileRedirectUrl}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Token</Text>
        <TextInput
          style={styles.input}
          placeholder="session token"
          autoCapitalize="none"
          value={tokenInput}
          onChangeText={setTokenInput}
          editable={!busy}
        />
        <View style={styles.row}>
          <Pressable
            style={styles.button}
            disabled={busy}
            onPress={() => {
              void runBusyAction(async () => {
                const token = tokenInput.trim();
                await setSessionToken(token.length > 0 ? token : null);
                setActiveToken(token.length > 0 ? token : null);
                setMessage(token.length > 0 ? 'Session token saved.' : 'Session token cleared.');
              });
            }}
          >
            <Text style={styles.buttonText}>Save token</Text>
          </Pressable>
          <Pressable
            style={styles.buttonSecondary}
            disabled={busy}
            onPress={() => {
              void runBusyAction(async () => {
                const refreshed = await refreshSessionAndPersist();
                setTokenInput(refreshed.sessionToken);
                setActiveToken(refreshed.sessionToken);
                setCurrentUser(refreshed.user);
                setMessage('Session refreshed and persisted.');
              });
            }}
          >
            <Text style={styles.buttonSecondaryText}>Refresh session</Text>
          </Pressable>
        </View>
        <View style={styles.row}>
          <Pressable
            style={styles.buttonSecondary}
            disabled={busy}
            onPress={() => {
              void runBusyAction(async () => {
                const meResult = await fetchMe();
                setCurrentUser(meResult.data);
                setMessage(
                  meResult.source === 'cache'
                    ? 'Loaded account from cache while offline.'
                    : 'Loaded account from backend.',
                );
              });
            }}
          >
            <Text style={styles.buttonSecondaryText}>Load account</Text>
          </Pressable>
          <Pressable
            style={styles.buttonSecondary}
            disabled={busy}
            onPress={() => {
              void runBusyAction(async () => {
                await clearSession();
                setTokenInput('');
                setActiveToken(null);
                setCurrentUser(null);
                setMessage('Session removed from local storage.');
              });
            }}
          >
            <Text style={styles.buttonSecondaryText}>Sign out locally</Text>
          </Pressable>
        </View>
      </View>

      {loading ? <Text style={styles.meta}>Loading session state...</Text> : null}
      {activeToken ? <Text style={styles.meta}>Token saved: yes</Text> : <Text style={styles.meta}>Token saved: no</Text>}
      <Text style={styles.meta}>Pending offline updates: {pendingMutations}</Text>

      {currentUser ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Current user</Text>
          <Text style={styles.cardBody}>ID: {currentUser.id}</Text>
          <Text style={styles.cardBody}>Email: {currentUser.email ?? 'none'}</Text>
          <Text style={styles.cardBody}>Display name: {currentUser.displayName ?? 'none'}</Text>
        </View>
      ) : null}

      {message ? <Text style={styles.success}>{message}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable style={styles.retryButton} disabled={busy || loading} onPress={() => void loadSession()}>
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
  section: {
    backgroundColor: '#fff7ef',
    borderRadius: 14,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: '#e2d4c5',
  },
  sectionTitle: {
    color: '#2f251f',
    fontWeight: '700',
    fontSize: 16,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  choice: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cdb9a4',
  },
  choiceActive: {
    backgroundColor: '#1f1a17',
    borderColor: '#1f1a17',
  },
  choiceLabel: {
    color: '#463a31',
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  choiceLabelActive: {
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
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#fff7ef',
  },
  buttonSecondaryText: {
    color: '#1f1a17',
    fontWeight: '700',
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2d4c5',
    padding: 14,
    backgroundColor: '#fff7ef',
    gap: 6,
  },
  cardTitle: {
    color: '#2f251f',
    fontWeight: '700',
    fontSize: 16,
  },
  cardBody: {
    color: '#4c423b',
    fontSize: 14,
  },
  success: {
    color: '#0a6a3c',
    fontWeight: '600',
  },
  error: {
    color: '#8a1f2d',
    fontWeight: '600',
  },
  meta: {
    color: '#5b4e45',
    fontSize: 13,
  },
  retryButton: {
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
