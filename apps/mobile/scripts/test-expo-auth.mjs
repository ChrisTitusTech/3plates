import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [platform, outputDirectory = 'test-results/expo-auth'] = process.argv.slice(2);
const mobileRoot = fileURLToPath(new URL('../', import.meta.url));
const appId = 'com.christitustech.threeplates';
const authCallback = 'threeplates://auth/callback';
const providers = ['Google', 'Apple', 'WHOOP'];
const cliEnv = { ...process.env };
// The parent may have been started with npm exec --call and --package.
delete cliEnv.npm_config_call;
delete cliEnv.npm_config_package;

function eas(...args) {
  return execFileSync('npx', ['--yes', 'eas-cli@27.11.0', ...args], {
    cwd: mobileRoot,
    env: cliEnv,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
  });
}

function device(...args) {
  return eas('simulator:exec', 'npx', '--yes', 'agent-device@0.21.41', ...args);
}

function openAndVerify(url, expectedText) {
  device('open', url, '--platform', platform);
  device('wait', 'text', expectedText);
  console.log(`Verified ${expectedText}`);
}

function verifyProviderHandoff(provider) {
  const providerLabel = `Continue with ${provider}`;
  device('open', 'threeplates://sign-in', '--platform', platform);
  device('wait', 'text', providerLabel);
  device('press', `label="${providerLabel}"`);

  for (let attempt = 0; attempt < 5; attempt++) {
    const { data } = JSON.parse(device('appstate', '--json'));
    const leftApp = platform === 'android'
      ? data.package === 'com.android.chrome'
      : ['runningBackground', 'runningBackgroundSuspended'].includes(data.state);
    if (leftApp) return;
  }

  const screen = device('snapshot', '--force-full').trim();
  throw new Error(`${provider} did not hand off to the browser on ${platform}.\n${screen}`);
}

try {
  if (platform !== 'android' && platform !== 'ios') {
    throw new Error('Usage: pnpm test:simulator:auth <android|ios> [output directory]');
  }

  const session = JSON.parse(eas('simulator:get', '--json', '--non-interactive'));
  if (session.status !== 'IN_PROGRESS' || session.platform !== platform.toUpperCase() || !session.remoteConfig) {
    throw new Error(`Start a ready ${platform} Expo Simulators session before running this test.`);
  }

  const evidenceDirectory = resolve(mobileRoot, outputDirectory);
  mkdirSync(evidenceDirectory, { recursive: true });
  device('open', appId, '--foreground', '--platform', platform);
  openAndVerify(authCallback, 'Missing authentication callback parameters.');
  openAndVerify(
    `${authCallback}?exchangeCode=synthetic-test-code&state=synthetic-test-state`,
    'No matching pending sign-in. Start sign-in again.',
  );

  device('open', 'threeplates://sign-in', '--platform', platform);
  for (const provider of providers) {
    device('wait', 'text', `Continue with ${provider}`);
  }
  console.log(`Verified sign-in options for ${providers.join(', ')}`);
  console.log(device('screenshot', join(evidenceDirectory, `${platform}-sign-in.png`), '--scale', '0.8').trim());
  for (const provider of providers) {
    verifyProviderHandoff(provider);
    console.log(`Verified browser handoff for ${provider}`);
  }
} catch (error) {
  console.error((error.stderr || error.message).trim());
  process.exitCode = 1;
}
