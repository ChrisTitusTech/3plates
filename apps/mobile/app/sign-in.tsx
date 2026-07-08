import { useEffect, useRef, useState } from 'react';
import * as ExpoLinking from 'expo-linking';
import { useRouter } from 'expo-router';
import {
  Linking,
} from 'react-native';

import { AuthLanding } from '../src/components/AuthLanding';
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
          router.replace('/progress');
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
          router.replace('/progress');
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
    <AuthLanding
      busy={busy}
      buttonLabel={busy ? 'Signing in' : 'Continue with Google'}
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
    />
  );
}
