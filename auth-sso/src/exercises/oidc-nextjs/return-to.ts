/** Where to land after logging in when no valid `returnTo` was given. */
export const DEFAULT_RETURN_TO = '/oidc-nextjs';

const BASE = 'http://return-to.invalid';

/**
 * Accepts only a path on this app. `returnTo` arrives in the query string, so without this check
 * `/api/auth/login?returnTo=https://evil.example` would turn the login into an open redirect that ends
 * on an attacker's page right after a genuine sign-in.
 */
export function safeReturnTo(value: string | null | undefined): string {
  // `//evil.example` and `/\evil.example` are protocol-relative URLs to another host.
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return DEFAULT_RETURN_TO;
  const url = URL.parse(value, BASE);
  if (!url || url.origin !== BASE) return DEFAULT_RETURN_TO;
  return `${url.pathname}${url.search}${url.hash}`;
}
