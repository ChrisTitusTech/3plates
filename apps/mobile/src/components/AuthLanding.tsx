import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AuthBackground } from './AuthBackground';

type AuthLandingProps = {
  busy?: boolean;
  actions?: Array<{ label: string; onPress(): void }>;
  error?: string | null;
  buttonLabel: string;
  onPress: () => void;
};

export function AuthLanding({ busy = false, buttonLabel, onPress, actions, error }: AuthLandingProps) {
  return (
    <AuthBackground>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.page}>
        <View style={styles.brandBlock}>
          <Text style={styles.logo}>3Plates</Text>
          <Text style={styles.title}>Training, recovery, and daily health</Text>
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Welcome back</Text>
          {error && <Text accessibilityRole="alert" style={{ color: '#a52c36' }}>{error}</Text>}
          {(actions ?? [{ label: buttonLabel, onPress }]).map((action) => <Pressable
            key={action.label}
            style={[styles.button, busy ? styles.buttonDisabled : null]}
            disabled={busy}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            onPress={action.onPress}
          >
            <Text style={styles.buttonText}>{action.label}</Text>
          </Pressable>)}
        </View>
      </ScrollView>
    </AuthBackground>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  page: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 36,
    justifyContent: 'space-between',
    gap: 32,
  },
  brandBlock: {
    paddingTop: 48,
    gap: 8,
  },
  logo: {
    color: '#ffffff',
    fontSize: 44,
    fontWeight: '900',
  },
  title: {
    color: '#d6dde7',
    fontSize: 20,
    fontWeight: '800',
  },
  panel: {
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    padding: 20,
    gap: 18,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.22,
    shadowRadius: 24,
    elevation: 10,
  },
  panelTitle: {
    color: '#17202a',
    fontSize: 22,
    fontWeight: '900',
  },
  button: {
    minHeight: 52,
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
    opacity: 0.62,
  },
});
