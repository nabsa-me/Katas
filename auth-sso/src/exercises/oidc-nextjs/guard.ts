import type { Role } from '../../lib/roles';
import type { SessionUser } from './session';

export type AccessDecision =
  | { type: 'allow' }
  /** A page without a session: send the browser to log in and come back. */
  | { type: 'login'; location: string }
  /** An API without a session (401) or a user without the role (403). APIs answer JSON, pages a 403 page. */
  | { type: 'deny'; status: 401 | 403; body: 'json' | 'page' };

/**
 * The authorization rule for protected routes, as a pure function so every branch is unit tested.
 * The proxy applies it before rendering, and the protected page and API call `hasRole` again.
 */
export function decideAccess(
  request: { pathname: string; search: string },
  user: SessionUser | null,
  requiredRole: Role,
): AccessDecision {
  const isApi = request.pathname.startsWith('/api/');
  if (!user) {
    if (isApi) return { type: 'deny', status: 401, body: 'json' };
    const returnTo = encodeURIComponent(`${request.pathname}${request.search}`);
    return { type: 'login', location: `/api/auth/login?returnTo=${returnTo}` };
  }
  if (!hasRole(user, requiredRole)) return { type: 'deny', status: 403, body: isApi ? 'json' : 'page' };
  return { type: 'allow' };
}

export function hasRole(user: SessionUser | null, role: Role): boolean {
  return user?.roles.includes(role) ?? false;
}
