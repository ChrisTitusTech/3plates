import { StyleSheet, Text, View } from 'react-native';

export default function PreferencesScreen() {
  return (
    <View style={styles.page}>
      <Text style={styles.title}>Preferences scaffold</Text>
      <Text style={styles.body}>
        Keep user preferences in the central database so web, Android, and iOS
        stay aligned.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    backgroundColor: '#f6f1e8',
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#1f1a17',
    marginBottom: 12,
  },
  body: {
    color: '#4c423b',
    fontSize: 16,
    lineHeight: 24,
    maxWidth: 520,
  },
});
