import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

const tiles = [
  { href: '/sign-in', label: 'Sign in' },
  { href: '/progress', label: 'Progress' },
  { href: '/preferences', label: 'Preferences' },
  { href: '/notifications', label: 'Notifications' },
];

export default function HomeScreen() {
  return (
    <View style={styles.page}>
      <Text style={styles.kicker}>3plates</Text>
      <Text style={styles.title}>One account. Three surfaces. One source of truth.</Text>
      <Text style={styles.body}>
        Expo powers the web, Android, and iOS client while the backend owns
        progress, preferences, auth, and notifications.
      </Text>

      <View style={styles.grid}>
        {tiles.map((tile) => (
          <Link key={tile.href} href={tile.href} style={styles.tile}>
            <Text style={styles.tileLabel}>{tile.label}</Text>
          </Link>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#f6f1e8',
    padding: 24,
    justifyContent: 'center',
    gap: 16,
  },
  kicker: {
    color: '#8b5e34',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  title: {
    color: '#1f1a17',
    fontSize: 40,
    fontWeight: '800',
    lineHeight: 46,
    maxWidth: 620,
  },
  body: {
    color: '#4c423b',
    fontSize: 16,
    lineHeight: 24,
    maxWidth: 560,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 8,
  },
  tile: {
    backgroundColor: '#1f1a17',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  tileLabel: {
    color: '#fff7ef',
    fontSize: 15,
    fontWeight: '700',
  },
});
