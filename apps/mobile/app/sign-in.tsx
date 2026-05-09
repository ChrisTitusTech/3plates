import { StyleSheet, Text, View } from 'react-native';

export default function SignInScreen() {
  return (
    <View style={styles.page}>
      <Text style={styles.title}>Authentication scaffold</Text>
      <Text style={styles.body}>
        Wire Google and Apple OAuth here. The backend should stay the source of
        truth for linked identities and sessions.
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
