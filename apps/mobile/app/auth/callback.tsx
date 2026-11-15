import { useMemo } from 'react';
import { useTheme, type ThemeColors } from '../../src/lib/theme';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { redeemMobileAuthExchangeCode } from '../../src/lib/api';

export default function AuthCallbackScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { exchangeCode } = useLocalSearchParams<{ exchangeCode?: string }>();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!exchangeCode) {
      setError('Missing exchange code in callback URL.');
      return;
    }

    let active = true;

    redeemMobileAuthExchangeCode(exchangeCode)
      .then(() => {
        if (active) {
          router.replace('/today');
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Sign-in failed.');
        }
      });

    return () => {
      active = false;
    };
  }, [exchangeCode, router]);

  return (
    <View style={styles.page}>
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <Text style={styles.message}>Completing sign-in…</Text>
      )}
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  page: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
    padding: 24,
  },
  message: {
    fontSize: 18,
    color: colors.muted,
  },
  error: {
    fontSize: 16,
    color: colors.danger,
    textAlign: 'center',
  },
});
