import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageName = 'com.christitustech.threeplates';
const mobileRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const defaultApk = join(mobileRoot, 'dist', '3plates-android-production.apk');
const defaultLogPath = join(mobileRoot, 'dist', 'android-device-smoke.log');

const options = parseArgs(process.argv.slice(2));
const apkPath = resolve(options.apk ?? defaultApk);
const logPath = resolve(options.log ?? defaultLogPath);
const timeoutMs = Number(options.timeoutMs ?? 15000);

function parseArgs(args) {
  const parsed = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') {
      continue;
    }

    if (!arg.startsWith('--')) {
      continue;
    }

    const [rawName, inlineValue] = arg.slice(2).split('=', 2);
    const nextValue = inlineValue ?? args[index + 1];

    if (['skip-install', 'keep-open', 'fresh'].includes(rawName)) {
      parsed[rawName] = true;
      continue;
    }

    if (inlineValue === undefined) {
      index += 1;
    }

    parsed[rawName] = nextValue;
  }

  return {
    apk: parsed.apk,
    device: parsed.device,
    log: parsed.log,
    timeoutMs: parsed.timeout,
    skipInstall: Boolean(parsed['skip-install']),
    keepOpen: Boolean(parsed['keep-open']),
    fresh: Boolean(parsed.fresh),
  };
}

function adbPath() {
  const sdkRoots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.platform === 'win32' && process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, 'Android', 'Sdk')
      : undefined,
    process.env.HOME ? join(process.env.HOME, 'Library', 'Android', 'sdk') : undefined,
    process.env.HOME ? join(process.env.HOME, 'Android', 'Sdk') : undefined,
  ].filter(Boolean);

  for (const sdkRoot of sdkRoots) {
    const candidate = process.platform === 'win32'
      ? join(sdkRoot, 'platform-tools', 'adb.exe')
      : join(sdkRoot, 'platform-tools', 'adb');

    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return 'adb';
}

const adb = adbPath();

function runAdb(args, { allowFailure = false } = {}) {
  const commandArgs = options.device ? ['-s', options.device, ...args] : args;

  try {
    return execFileSync(adb, commandArgs, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const output = [
      error.stdout?.toString(),
      error.stderr?.toString(),
    ].filter(Boolean).join('\n').trim();

    if (allowFailure) {
      return output;
    }

    throw new Error(output || `${adb} ${commandArgs.join(' ')} failed`);
  }
}

function listDevices() {
  return execFileSync(adb, ['devices', '-l'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial, state] = line.split(/\s+/, 2);
      return { serial, state, line };
    });
}

function selectDevice() {
  const devices = listDevices();
  const readyDevices = devices.filter((device) => device.state === 'device');

  if (options.device) {
    const selected = devices.find((device) => device.serial === options.device);
    if (!selected) {
      throw new Error(`Android device ${options.device} was not found.\n${devices.map((device) => device.line).join('\n')}`);
    }

    if (selected.state !== 'device') {
      throw new Error(`Android device ${options.device} is ${selected.state}. Unlock it and approve USB debugging.`);
    }

    return selected;
  }

  if (readyDevices.length === 0) {
    throw new Error('No Android device is connected. Connect a phone, enable USB debugging, and run adb devices.');
  }

  if (readyDevices.length > 1) {
    throw new Error(`Multiple Android devices are connected. Pass --device <serial>.\n${readyDevices.map((device) => device.line).join('\n')}`);
  }

  options.device = readyDevices[0].serial;
  return readyDevices[0];
}

function installApk() {
  if (options.skipInstall) {
    console.log('Skipping APK install.');
    return;
  }

  if (!existsSync(apkPath)) {
    throw new Error(`APK not found at ${apkPath}. Run pnpm --filter @3plates/mobile build:android:production first.`);
  }

  console.log(`Installing ${apkPath}`);
  const installOutput = runAdb(['install', '-r', '-d', apkPath], { allowFailure: true });
  if (/Success/i.test(installOutput)) {
    console.log('APK install succeeded.');
    return;
  }

  if (/INSTALL_FAILED_UPDATE_INCOMPATIBLE|INSTALL_FAILED_VERSION_DOWNGRADE/i.test(installOutput)) {
    runAdb(['uninstall', packageName], { allowFailure: true });
    const retryOutput = runAdb(['install', '-d', apkPath], { allowFailure: true });
    if (/Success/i.test(retryOutput)) {
      console.log('APK install succeeded after uninstall retry.');
      return;
    }

    throw new Error(`APK install failed after uninstall retry:\n${retryOutput}`);
  }

  throw new Error(`APK install failed:\n${installOutput}`);
}

function sleep(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

function filterImportantLogs(logcat) {
  const importantPattern = new RegExp([
    'FATAL EXCEPTION',
    'Fatal signal',
    'AndroidRuntime',
    packageName.replaceAll('.', '\\.'),
    'ReactNativeJS',
    'RuntimeException',
    'UnsatisfiedLinkError',
    'SoLoader',
  ].join('|'), 'i');

  return logcat
    .split(/\r?\n/)
    .filter((line) => importantPattern.test(line))
    .slice(-160)
    .join('\n');
}

async function main() {
  const device = selectDevice();
  console.log(`Testing ${packageName} on ${device.serial}`);

  installApk();

  if (options.fresh) {
    console.log('Clearing app data.');
    runAdb(['shell', 'pm', 'clear', packageName], { allowFailure: true });
  }

  console.log('Clearing logcat and launching app.');
  runAdb(['logcat', '-c'], { allowFailure: true });
  runAdb(['shell', 'am', 'force-stop', packageName], { allowFailure: true });

  const launchOutput = runAdb(['shell', 'monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1'], {
    allowFailure: true,
  });

  console.log(launchOutput);
  console.log(`Waiting ${timeoutMs}ms for startup.`);
  await sleep(timeoutMs);

  console.log('Collecting process state and logcat.');
  const pid = runAdb(['shell', 'pidof', packageName], { allowFailure: true }).trim();
  const logcat = runAdb(['logcat', '-d', '-v', 'time'], { allowFailure: true });
  mkdirSync(dirname(logPath), { recursive: true });
  writeFileSync(logPath, logcat);

  const importantLogs = filterImportantLogs(logcat);
  const hasFatalCrash = /FATAL EXCEPTION|Fatal signal|Process: com\.christitustech\.threeplates/i.test(importantLogs);

  if (!options.keepOpen) {
    runAdb(['shell', 'am', 'force-stop', packageName], { allowFailure: true });
  }

  if (!pid || hasFatalCrash) {
    console.error(`Android device smoke test failed. Full log: ${logPath}`);
    if (importantLogs) {
      console.error('\nRelevant logcat lines:\n');
      console.error(importantLogs);
    }

    process.exit(1);
  }

  console.log(`Android device smoke test passed. PID ${pid}. Full log: ${logPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
