import { useEffect, useState } from 'react';
import { Link, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AuthLanding } from '../src/components/AuthLanding';
import { SettingsCog } from '../src/components/SettingsCog';
import { clearSession, fetchMe, getSessionToken } from '../src/lib/api';

export default function HomeScreen() {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    const fallback = setTimeout(() => {
      if (active) {
        setSignedIn(false);
      }
    }, 2500);

    async function loadSession() {
      const token = await getSessionToken();
      if (!token) {
        if (active) {
          clearTimeout(fallback);
          setSignedIn(false);
        }
        return;
      }

      try {
        await fetchMe();
        if (active) {
          clearTimeout(fallback);
          setSignedIn(true);
        }
      } catch {
        await clearSession();
        if (active) {
          clearTimeout(fallback);
          setSignedIn(false);
        }
      }
    }

    void loadSession();

    return () => {
      active = false;
      clearTimeout(fallback);
    };
  }, []);

  if (signedIn === null) {
    return (
      <AuthLanding
        busy
        buttonLabel="Checking session"
        onPress={() => router.push('/sign-in')}
      />
    );
  }

  if (!signedIn) {
    return (
      <AuthLanding
        buttonLabel="Sign in"
        onPress={() => router.push('/sign-in')}
      />
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.page}>
      <View style={styles.topBar}>
        <View />
        <SettingsCog />
      </View>

      <View style={styles.actions}>
        <Link href="/progress" asChild>
          <Pressable style={styles.primaryButton} accessibilityRole="link">
            <Text style={styles.primaryButtonText}>Progress</Text>
          </Pressable>
        </Link>

        <Link href="/workouts" asChild>
          <Pressable style={styles.secondaryButton} accessibilityRole="link">
            <Text style={styles.secondaryButtonText}>Workouts</Text>
          </Pressable>
        </Link>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: '#f7f8fa',
  },
  page: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    flexGrow: 1,
    padding: 24,
    backgroundColor: '#f7f8fa',
    gap: 24,
  },
  topBar: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  actions: {
    flex: 1,
    justifyContent: 'center',
    gap: 12,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#17202a',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryButton: {
    minHeight: 52,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#17202a',
    backgroundColor: '#ffffff',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  secondaryButtonText: {
    color: '#17202a',
    fontSize: 16,
    fontWeight: '800',
  },
});
