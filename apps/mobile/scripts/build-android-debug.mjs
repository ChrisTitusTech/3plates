import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const productionApiUrl = 'https://api.3spinningplates.com';
const mobileRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const androidRoot = join(mobileRoot, 'android');
const outputApk = join(androidRoot, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const distApk = join(mobileRoot, 'dist', '3plates-android-debug.apk');

function requireEnvironment(name) {
  if (!process.env[name]) {
    throw new Error(`${name} is required for Android builds.`);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: mobileRoot,
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || 'production',
      EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL || productionApiUrl,
    },
    shell: process.platform === 'win32',
    stdio: 'inherit',
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with status ${result.status ?? 'unknown'}.`);
  }
}

requireEnvironment('JAVA_HOME');
requireEnvironment('ANDROID_HOME');

run('expo', ['prebuild', '--platform', 'android', '--clean']);

const gradleCommand = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
run(gradleCommand, ['assembleDebug'], {
  cwd: androidRoot,
});

if (!existsSync(outputApk)) {
  throw new Error(`Expected APK was not created at ${outputApk}.`);
}

mkdirSync(dirname(distApk), { recursive: true });
copyFileSync(outputApk, distApk);
console.log(`Android debug APK ready: ${distApk}`);
