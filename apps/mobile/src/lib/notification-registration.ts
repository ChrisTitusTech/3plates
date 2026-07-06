import type { NotificationDevice } from '@3plates/contract';

type PermissionResponse = {
  status: string;
};

type NativePushAdapter = {
  projectId?: string | null;
  getPermissionsAsync: () => Promise<PermissionResponse>;
  requestPermissionsAsync: () => Promise<PermissionResponse>;
  getExpoPushTokenAsync: (input?: { projectId?: string }) => Promise<{ data: string }>;
};

type WebPushAdapter = {
  isSupported: () => boolean;
  getPermission: () => NotificationPermission;
  requestPermission: () => Promise<NotificationPermission>;
  getSubscription: (vapidPublicKey: string) => Promise<unknown>;
};

export type NotificationDeviceRegistrationResult =
  | {
      status: 'ready';
      device: NotificationDevice;
    }
  | {
      status: 'manual_required';
      platform: NotificationDevice['platform'];
      message: string;
    }
  | {
      status: 'permission_denied';
      platform: NotificationDevice['platform'];
      message: string;
    };

type NotificationDeviceRegistrationOptions = {
  platform?: NotificationDevice['platform'];
  nativePushAdapter?: NativePushAdapter;
  webPushAdapter?: WebPushAdapter;
  webPushVapidPublicKey?: string | null;
};

type ExpoConstantsLike = {
  expoConfig?: {
    extra?: {
      eas?: {
        projectId?: string;
      };
    };
  };
  easConfig?: {
    projectId?: string;
  };
};

export function getRuntimeNotificationPlatform(): NotificationDevice['platform'] {
  let os: string | undefined;

  try {
    const reactNative = require('react-native') as {
      Platform?: {
        OS?: string;
      };
    };
    os = reactNative.Platform?.OS;
  } catch {
    os = undefined;
  }

  if (os === 'ios' || os === 'android') {
    return os;
  }

  return 'web';
}

function getExpoProjectId(constants: ExpoConstantsLike) {
  return constants.expoConfig?.extra?.eas?.projectId ?? constants.easConfig?.projectId ?? null;
}

async function createNativePushAdapter(): Promise<NativePushAdapter> {
  const [Notifications, ConstantsModule] = await Promise.all([
    import('expo-notifications'),
    import('expo-constants'),
  ]);
  const constants = ConstantsModule.default as ExpoConstantsLike;

  return {
    projectId: getExpoProjectId(constants),
    getPermissionsAsync: Notifications.getPermissionsAsync,
    requestPermissionsAsync: Notifications.requestPermissionsAsync,
    getExpoPushTokenAsync: Notifications.getExpoPushTokenAsync,
  };
}

function decodeBase64UrlToUint8Array(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const binary =
    typeof atob === 'function'
      ? atob(base64)
      : Buffer.from(base64, 'base64').toString('binary');
  const output = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }

  return output;
}

function createWebPushAdapter(): WebPushAdapter {
  return {
    isSupported() {
      return (
        typeof window !== 'undefined'
        && 'Notification' in window
        && 'PushManager' in window
        && typeof navigator !== 'undefined'
        && 'serviceWorker' in navigator
      );
    },
    getPermission() {
      return Notification.permission;
    },
    requestPermission() {
      return Notification.requestPermission();
    },
    async getSubscription(vapidPublicKey) {
      const registration = await navigator.serviceWorker.register('/notifications-sw.js');
      const readyRegistration = await navigator.serviceWorker.ready.catch(() => registration);
      const existingSubscription = await readyRegistration.pushManager.getSubscription();

      if (existingSubscription) {
        return existingSubscription.toJSON();
      }

      const subscription = await readyRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeBase64UrlToUint8Array(vapidPublicKey),
      });

      return subscription.toJSON();
    },
  };
}

function getWebPushVapidPublicKey(options: NotificationDeviceRegistrationOptions) {
  return (
    options.webPushVapidPublicKey
    ?? process.env.EXPO_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY
    ?? null
  );
}

async function requestNativeNotificationDevice(
  platform: Extract<NotificationDevice['platform'], 'ios' | 'android'>,
  options: NotificationDeviceRegistrationOptions,
): Promise<NotificationDeviceRegistrationResult> {
  const adapter = options.nativePushAdapter ?? await createNativePushAdapter();
  let permission = await adapter.getPermissionsAsync();

  if (permission.status !== 'granted') {
    permission = await adapter.requestPermissionsAsync();
  }

  if (permission.status !== 'granted') {
    return {
      status: 'permission_denied',
      platform,
      message: 'Notification permission was not granted.',
    };
  }

  const token = await adapter.getExpoPushTokenAsync(
    adapter.projectId ? { projectId: adapter.projectId } : undefined,
  );

  return {
    status: 'ready',
    device: {
      platform,
      pushToken: token.data,
    },
  };
}

async function requestWebNotificationDevice(
  options: NotificationDeviceRegistrationOptions,
): Promise<NotificationDeviceRegistrationResult> {
  const adapter = options.webPushAdapter ?? createWebPushAdapter();
  const vapidPublicKey = getWebPushVapidPublicKey(options);

  if (!adapter.isSupported()) {
    return {
      status: 'manual_required',
      platform: 'web',
      message: 'Browser push is not available in this runtime.',
    };
  }

  if (!vapidPublicKey) {
    return {
      status: 'manual_required',
      platform: 'web',
      message: 'Set EXPO_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY to register web push tokens.',
    };
  }

  let permission = adapter.getPermission();
  if (permission === 'default') {
    permission = await adapter.requestPermission();
  }

  if (permission !== 'granted') {
    return {
      status: 'permission_denied',
      platform: 'web',
      message: 'Notification permission was not granted.',
    };
  }

  const subscription = await adapter.getSubscription(vapidPublicKey);
  const pushToken = typeof subscription === 'string' ? subscription : JSON.stringify(subscription);

  return {
    status: 'ready',
    device: {
      platform: 'web',
      pushToken,
    },
  };
}

export async function requestNotificationDeviceRegistration(
  options: NotificationDeviceRegistrationOptions = {},
): Promise<NotificationDeviceRegistrationResult> {
  const platform = options.platform ?? getRuntimeNotificationPlatform();

  if (platform === 'web') {
    return requestWebNotificationDevice(options);
  }

  return requestNativeNotificationDevice(platform, options);
}
