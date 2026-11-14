import type { PropsWithChildren } from 'react';
import { Image, StyleSheet, View } from 'react-native';

const gymBackground = require('../../assets/gym-sign-in-background.png');

export function AuthBackground({ children }: PropsWithChildren) {
  return (
    <View style={styles.background}>
      <Image
        source={gymBackground}
        resizeMode="cover"
        blurRadius={10}
        style={styles.image}
        accessible={false}
        pointerEvents="none"
      />
      <View pointerEvents="none" style={styles.scrim} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  background: {
    flex: 1,
    width: '100%',
    backgroundColor: '#111827',
    overflow: 'hidden',
  },
  image: {
    ...StyleSheet.absoluteFill,
    width: '100%',
    height: '100%',
    opacity: 0.92,
  },
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(8, 13, 22, 0.48)',
  },
});
