import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const productionApiUrl = 'https://api.3spinningplates.com';
const mobileRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const androidRoot = join(mobileRoot, 'android');

const buildVariants = {
  debug: {
    gradleTask: 'assembleDebug',
    outputApk: join(androidRoot, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'),
    distApk: join(mobileRoot, 'dist', '3plates-android-debug.apk'),
  },
  production: {
    gradleTask: 'assembleRelease',
    outputApk: join(androidRoot, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'),
    distApk: join(mobileRoot, 'dist', '3plates-android-production.apk'),
    env: {
      ORG_GRADLE_PROJECT_reactNativeArchitectures:
        process.env.ORG_GRADLE_PROJECT_reactNativeArchitectures || 'arm64-v8a',
    },
  },
};

const variantName = process.argv[2] ?? 'production';
const buildVariant = buildVariants[variantName];

if (!buildVariant) {
  throw new Error(`Unknown Android APK variant "${variantName}". Expected "debug" or "production".`);
}

function requireEnvironment(name) {
  if (!process.env[name]) {
    throw new Error(`${name} is required for Android builds.`);
  }
}

function run(command, args, options = {}) {
  const isWindowsScript = process.platform === 'win32' && /\.(bat|cmd)$/i.test(command);
  const result = spawnSync(isWindowsScript ? 'cmd.exe' : command, isWindowsScript ? ['/d', '/s', '/c', command, ...args] : args, {
    cwd: options.cwd ?? mobileRoot,
    env: {
      ...process.env,
      ...(buildVariant.env ?? {}),
      NODE_ENV: process.env.NODE_ENV || 'production',
      EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL || productionApiUrl,
    },
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with status ${result.status ?? 'unknown'}.`);
  }
}

requireEnvironment('JAVA_HOME');
requireEnvironment('ANDROID_HOME');

if (process.platform === 'win32' && mobileRoot.length > 40) {
  console.warn(
    'Windows native builds can fail under long checkout paths. If CMake reports filename length errors, '
      + 'rerun this from a short real path such as C:\\3p-apk.',
  );
}

const expoCommand = process.platform === 'win32' ? 'expo.cmd' : 'expo';
run(expoCommand, ['prebuild', '--platform', 'android', '--clean']);

const gradleCommand = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
run(gradleCommand, [buildVariant.gradleTask], {
  cwd: androidRoot,
});

if (!existsSync(buildVariant.outputApk)) {
  throw new Error(`Expected APK was not created at ${buildVariant.outputApk}.`);
}

mkdirSync(dirname(buildVariant.distApk), { recursive: true });
copyFileSync(buildVariant.outputApk, buildVariant.distApk);
console.log(`Android ${variantName} APK ready: ${buildVariant.distApk}`);
