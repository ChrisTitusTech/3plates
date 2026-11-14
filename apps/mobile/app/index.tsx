import { useEffect, useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { AuthLanding } from '../src/components/AuthLanding';
import { getSessionToken } from '../src/lib/api';

export default function HomeScreen() {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    void getSessionToken().then((token) => { if (active) setSignedIn(!!token); }).catch(() => { if (active) setSignedIn(false); });
    return () => { active = false; };
  }, []);
  if (signedIn) return <Redirect href="/today" />;
  return <AuthLanding busy={signedIn === null} buttonLabel={signedIn === null ? 'Checking session' : 'Sign in'} onPress={() => router.push('/sign-in')} />;
}
