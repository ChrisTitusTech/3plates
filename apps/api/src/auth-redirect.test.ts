import assert from 'node:assert/strict';
import test from 'node:test';
import { env } from './env.js';
import { isAllowedAuthRedirect } from './auth-redirect.js';

test('configured callbacks reject cleartext remote hosts but allow HTTPS and loopback', () => {
  const previous = env.AUTH_REDIRECT_URLS;
  const urls = ['http://client.example/auth/callback', 'https://client.example/auth/callback',
    'http://localhost:8081/auth/callback', 'http://127.0.0.1:8081/auth/callback',
    'http://[::1]:8081/auth/callback', 'http://localhost.evil.test/auth/callback'];
  env.AUTH_REDIRECT_URLS = urls.join(',');
  try {
    assert.deepEqual(urls.map(isAllowedAuthRedirect), [false, true, true, true, true, false]);
    assert.equal(isAllowedAuthRedirect('threeplates://auth/callback'), true);
  } finally {
    env.AUTH_REDIRECT_URLS = previous;
  }
});
