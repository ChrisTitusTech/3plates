import { env } from './env.js';

const defaultRedirects = [
  'threeplates://auth/callback',
  'threeplates://auth-finished',
  'https://3spinningplates.com/auth/callback',
  'https://www.3spinningplates.com/auth/callback',
];

export function isAllowedAuthRedirect(value: string): boolean {
  const configured = (env.AUTH_REDIRECT_URLS ?? '').split(',').map((url) => url.trim()).filter(Boolean);
  const allowed = [...defaultRedirects, ...configured];
  if (process.env.NODE_ENV !== 'production') {
    allowed.push(
      'http://localhost:8081/auth/callback',
      'http://localhost:3000/welcome',
      'http://localhost:3000/settings',
      'http://localhost:3000/auth/callback',
    );
  }
  try {
    const target = new URL(value);
    if (target.username || target.password || target.search || target.hash) return false;
    const loopbackHosts = ['localhost', '127.0.0.1', '[::1]'];
    if (target.protocol === 'http:' && !loopbackHosts.includes(target.hostname)) return false;
    return allowed.some((candidate) => {
      try { return target.href === new URL(candidate).href; } catch { return false; }
    });
  } catch {
    return false;
  }
}

export function requiresExchangeHandoff(redirectTo: string): boolean {
  try {
    const target = new URL(redirectTo);
    return (target.protocol !== 'http:' && target.protocol !== 'https:') || target.pathname === '/auth/callback';
  } catch {
    return false;
  }
}
