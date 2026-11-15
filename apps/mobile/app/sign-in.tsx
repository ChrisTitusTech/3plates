import type { AuthProvider } from '@3plates/contract';
import { useEffect, useRef, useState } from 'react';
import * as ExpoLinking from 'expo-linking';
import { useRouter } from 'expo-router';
import {
  Linking,
} from 'react-native';

import { AuthLanding } from '../src/components/AuthLanding';
import {
  apiBaseUrl,
  getSessionToken,
  redeemMobileAuthExchangeCode,
  startAuth,
} from '../src/lib/api';

export default function SignInScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<AuthProvider[]>([]);
  const [error, setError] = useState<string | null>(null);
  async function loadProviders() {
    setBusy(true); setError(null);
    try {
      const response = await fetch(apiBaseUrl + '/auth/providers');
      if (!response.ok) throw new Error('Unable to load sign-in providers.');
      setProviders((await response.json()).providers);
    } catch { setError('Cannot reach the sign-in server. Check your connection and retry.'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void loadProviders(); }, []);
  async function signIn(provider: AuthProvider) {
    setBusy(true); setError(null);
    try { const started = await startAuth(provider, mobileRedirectUrl); await Linking.openURL(started.next); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Sign-in failed.'); }
    finally { setBusy(false); }
  }
  const handledDeepLinkRef = useRef<string | null>(null);
  const mobileRedirectUrl = ExpoLinking.createURL('auth/callback');

  useEffect(() => {
    let active = true;

    getSessionToken()
      .then((token) => {
        if (active && token) {
          router.replace('/today');
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
          router.replace('/today');
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Sign-in failed.');
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

  return <AuthLanding busy={busy} buttonLabel="Loading sign-in options" onPress={() => {}}
    error={error ?? (providers.length === 0 ? 'Waiting for available sign-in providers.' : null)}
    actions={providers.length === 0 ? [{ label: 'Retry sign-in options', onPress: () => { void loadProviders(); } }] : providers.map((provider) => ({ label: `Continue with ${provider === 'whoop' ? 'WHOOP' : provider === 'google' ? 'Google' : 'Apple'}`,
      onPress: () => { void signIn(provider); } }))} />;
}
