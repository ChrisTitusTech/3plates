import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { getSessionGeneration, getSessionToken, subscribeSession } from './api';

export function useRequireSession() {
  const router = useRouter();
  // A new authenticated generation causes consumers to reload even if React
  // batches the intermediate signed-out state.
  const [ready, setReady] = useState(0);
  useEffect(() => {
    let active = true;
    const check = () => {
      const generation = getSessionGeneration();
      setReady(0);
      void getSessionToken().then((token) => {
        if (!active || generation !== getSessionGeneration()) return;
        if (!token) router.replace('/sign-in');
        else setReady(generation + 1);
      }).catch(() => {
        if (active && generation === getSessionGeneration()) router.replace('/sign-in');
      });
    };
    const unsubscribe = subscribeSession(check);
    check();
    return () => { active = false; unsubscribe(); };
  }, [router]);
  return ready;
}
