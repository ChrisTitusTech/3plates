import { StyleSheet, Text, View } from 'react-native';

export default function NotificationsScreen() {
  return (
    <View style={styles.page}>
      <Text style={styles.title}>Notifications scaffold</Text>
      <Text style={styles.body}>
        Register device tokens here and store push state in the backend for
        future delivery control.
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
