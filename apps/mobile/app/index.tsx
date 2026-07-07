import { useEffect, useState } from 'react';
import { Link } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SettingsCog } from '../src/components/SettingsCog';
import { clearSession, fetchMe, getSessionToken } from '../src/lib/api';

export default function HomeScreen() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;

    async function loadSession() {
      const token = await getSessionToken();
      if (!token) {
        if (active) {
          setSignedIn(false);
        }
        return;
      }

      try {
        await fetchMe();
        if (active) {
          setSignedIn(true);
        }
      } catch {
        await clearSession();
        if (active) {
          setSignedIn(false);
        }
      }
    }

    void loadSession();

    return () => {
      active = false;
    };
  }, []);

  if (signedIn === null) {
    return <View style={styles.blank} />;
  }

  if (!signedIn) {
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.signInPage}>
        <Link href="/sign-in" asChild>
          <Pressable style={styles.primaryButton} accessibilityRole="link">
            <Text style={styles.primaryButtonText}>Sign in</Text>
          </Pressable>
        </Link>
      </ScrollView>
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
    backgroundColor: '#f7f8fa',
    gap: 24,
  },
  signInPage: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    flexGrow: 1,
    padding: 24,
    backgroundColor: '#f7f8fa',
    alignItems: 'center',
    justifyContent: 'center',
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
