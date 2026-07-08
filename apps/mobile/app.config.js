const productionApiUrl = 'https://api.3spinningplates.com';
const appScheme = 'threeplates';
const appIdentifier = 'com.christitustech.threeplates';
const easProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID || process.env.EAS_PROJECT_ID || undefined;

module.exports = ({ config }) => ({
  ...config,
  name: '3Plates',
  slug: '3plates',
  scheme: appScheme,
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/app-icon.png',
  splash: {
    image: './assets/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#17202a',
  },
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: true,
    bundleIdentifier: appIdentifier,
  },
  android: {
    package: appIdentifier,
    permissions: ['POST_NOTIFICATIONS'],
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#17202a',
    },
    intentFilters: [
      {
        action: 'VIEW',
        data: [
          {
            scheme: appScheme,
          },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  web: {
    favicon: './assets/app-icon.png',
    bundler: 'metro',
  },
  plugins: ['expo-router', 'expo-secure-store', 'expo-notifications'],
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL || productionApiUrl,
    ...(easProjectId
      ? {
          eas: {
            projectId: easProjectId,
          },
        }
      : {}),
  },
});
