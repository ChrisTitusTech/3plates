import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

type ExpoConfigFactory = (input: { config: Record<string, unknown> }) => {
  name: string;
  scheme: string;
  extra?: {
    apiUrl?: string;
    eas?: {
      projectId?: string;
    };
  };
  android?: {
    package?: string;
    permissions?: string[];
  };
  ios?: {
    bundleIdentifier?: string;
  };
};

test('Expo native config pins rollout identifiers and environment wiring', () => {
  const previousApiUrl = process.env.EXPO_PUBLIC_API_URL;
  const previousExpoProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';
  process.env.EXPO_PUBLIC_EAS_PROJECT_ID = '11111111-1111-4111-8111-111111111111';

  try {
    const createConfig = require('../../app.config.js') as ExpoConfigFactory;
    const config = createConfig({ config: {} });

    assert.equal(config.name, '3Plates');
    assert.equal(config.scheme, 'threeplates');
    assert.equal(config.android?.package, 'com.christitustech.threeplates');
    assert.equal(config.ios?.bundleIdentifier, 'com.christitustech.threeplates');
    assert.equal(config.extra?.apiUrl, 'https://api.example.test');
    assert.equal(config.extra?.eas?.projectId, '11111111-1111-4111-8111-111111111111');
    assert.ok(config.android?.permissions?.includes('POST_NOTIFICATIONS'));
  } finally {
    if (previousApiUrl === undefined) {
      delete process.env.EXPO_PUBLIC_API_URL;
    } else {
      process.env.EXPO_PUBLIC_API_URL = previousApiUrl;
    }

    if (previousExpoProjectId === undefined) {
      delete process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
    } else {
      process.env.EXPO_PUBLIC_EAS_PROJECT_ID = previousExpoProjectId;
    }
  }
});
