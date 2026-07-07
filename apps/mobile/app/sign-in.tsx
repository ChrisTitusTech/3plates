import { useEffect, useRef, useState } from 'react';
import * as ExpoLinking from 'expo-linking';
import { useRouter } from 'expo-router';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
} from 'react-native';

import {
  getSessionToken,
  redeemMobileAuthExchangeCode,
  startAuth,
} from '../src/lib/api';

export default function SignInScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const handledDeepLinkRef = useRef<string | null>(null);
  const mobileRedirectUrl = ExpoLinking.createURL('auth/callback');

  useEffect(() => {
    let active = true;

    getSessionToken()
      .then((token) => {
        if (active && token) {
          router.replace('/');
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    let active = true;

    const handleDeepLink = async (url: string) => {
      if (!active || handledDeepLinkRef.current === url) {
        return;
      }

      const parsed = ExpoLinking.parse(url);
      if (parsed.path !== 'auth/callback') {
        return;
      }

      const exchangeCode = parsed.queryParams?.exchangeCode;
      if (typeof exchangeCode !== 'string') {
        return;
      }

      handledDeepLinkRef.current = url;
      setBusy(true);

      try {
        await redeemMobileAuthExchangeCode(exchangeCode);
        if (active) {
          router.replace('/');
        }
      } finally {
        if (active) {
          setBusy(false);
        }
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
  }, [router]);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.page}>
      <Pressable
        style={[styles.button, busy ? styles.buttonDisabled : null]}
        disabled={busy}
        accessibilityRole="button"
        accessibilityState={{ disabled: busy }}
        onPress={() => {
          void (async () => {
            setBusy(true);
            try {
              const started = await startAuth('google', mobileRedirectUrl);
              await Linking.openURL(started.next);
            } catch {
              return;
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        <Text style={styles.buttonText}>{busy ? 'Signing in' : 'Sign in'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    backgroundColor: '#f7f8fa',
  },
  page: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    flexGrow: 1,
    padding: 24,
    backgroundColor: '#f7f8fa',
    alignItems: 'center',
    justifyContent: 'center',
  },
  button: {
    minHeight: 52,
    minWidth: 180,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#17202a',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
