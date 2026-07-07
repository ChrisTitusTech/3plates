import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';

import { getSessionToken } from './api';

export function useRequireSession() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;

    getSessionToken()
      .then((token) => {
        if (!active) {
          return;
        }

        if (!token) {
          router.replace('/sign-in');
          return;
        }

        setReady(true);
      })
      .catch(() => {
        if (active) {
          router.replace('/sign-in');
        }
      });

    return () => {
      active = false;
    };
  }, [router]);

  return ready;
}
