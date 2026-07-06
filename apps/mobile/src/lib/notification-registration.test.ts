import assert from 'node:assert/strict';
import test from 'node:test';

import { requestNotificationDeviceRegistration } from './notification-registration';

test('web notification registration returns a backend device payload', async () => {
  let requestedPermission = false;
  let subscribedWithKey: string | null = null;

  const result = await requestNotificationDeviceRegistration({
    platform: 'web',
    webPushVapidPublicKey: 'test-public-key',
    webPushAdapter: {
      isSupported: () => true,
      getPermission: () => 'default',
      requestPermission: async () => {
        requestedPermission = true;
        return 'granted';
      },
      getSubscription: async (vapidPublicKey) => {
        subscribedWithKey = vapidPublicKey;
        return {
          endpoint: 'https://push.example.test/subscription',
          keys: {
            p256dh: 'public-key',
            auth: 'auth-secret',
          },
        };
      },
    },
  });

  assert.equal(result.status, 'ready');
  assert.equal(requestedPermission, true);
  assert.equal(subscribedWithKey, 'test-public-key');

  if (result.status === 'ready') {
    assert.equal(result.device.platform, 'web');
    assert.match(result.device.pushToken, /push\.example\.test/);
  }
});

test('web notification registration asks for manual setup without a VAPID key', async () => {
  let requestedPermission = false;

  const result = await requestNotificationDeviceRegistration({
    platform: 'web',
    webPushVapidPublicKey: null,
    webPushAdapter: {
      isSupported: () => true,
      getPermission: () => 'default',
      requestPermission: async () => {
        requestedPermission = true;
        return 'granted';
      },
      getSubscription: async () => {
        throw new Error('Subscription should not be requested without a VAPID key.');
      },
    },
  });

  assert.equal(result.status, 'manual_required');
  assert.equal(requestedPermission, false);
});

test('native notification registration requests permission and returns an Expo token', async () => {
  let requestedPermission = false;
  let projectId: string | undefined;

  const result = await requestNotificationDeviceRegistration({
    platform: 'ios',
    nativePushAdapter: {
      projectId: 'project-123',
      getPermissionsAsync: async () => ({ status: 'undetermined' }),
      requestPermissionsAsync: async () => {
        requestedPermission = true;
        return { status: 'granted' };
      },
      getExpoPushTokenAsync: async (input) => {
        projectId = input?.projectId;
        return { data: 'ExponentPushToken[native-token]' };
      },
    },
  });

  assert.equal(result.status, 'ready');
  assert.equal(requestedPermission, true);
  assert.equal(projectId, 'project-123');

  if (result.status === 'ready') {
    assert.deepEqual(result.device, {
      platform: 'ios',
      pushToken: 'ExponentPushToken[native-token]',
    });
  }
});

test('notification registration returns permission_denied when permission is blocked', async () => {
  const result = await requestNotificationDeviceRegistration({
    platform: 'android',
    nativePushAdapter: {
      getPermissionsAsync: async () => ({ status: 'denied' }),
      requestPermissionsAsync: async () => ({ status: 'denied' }),
      getExpoPushTokenAsync: async () => {
        throw new Error('Token should not be requested when permission is denied.');
      },
    },
  });

  assert.deepEqual(result, {
    status: 'permission_denied',
    platform: 'android',
    message: 'Notification permission was not granted.',
  });
});
