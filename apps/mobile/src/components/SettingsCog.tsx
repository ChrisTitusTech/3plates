import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

export function SettingsCog() {
  return (
    <Link href="/preferences" asChild>
      <Pressable
        style={styles.button}
        accessibilityLabel="Settings"
        accessibilityRole="link"
      >
        <Text style={styles.icon}>⚙</Text>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#cfd6df',
    backgroundColor: '#ffffff',
  },
  icon: {
    color: '#17202a',
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 24,
  },
});
