import { hasRole } from './guard';
import type { SessionUser } from './session';

export interface AccessReviewEntry {
  user: string;
  groups: string[];
  lastSignIn: string;
}

/** Fictional data that only admins may see. */
export const ACCESS_REVIEW: readonly AccessReviewEntry[] = [
  { user: 'ada', groups: ['katas-admins'], lastSignIn: '2026-11-20' },
  { user: 'grace', groups: ['katas-readers'], lastSignIn: '2026-11-18' },
  { user: 'alan', groups: ['katas-readers'], lastSignIn: '2026-09-02' },
];

/**
 * The admin report API. It checks the role itself, on the server, even though the proxy already did:
 * a matcher that misses a path, or a new route added later, must not open the data.
 */
export function adminReportResponse(user: SessionUser | null): Response {
  if (!user) return Response.json({ error: 'unauthenticated' }, { status: 401 });
  if (!hasRole(user, 'admin')) return Response.json({ error: 'forbidden' }, { status: 403 });
  return Response.json({ entries: ACCESS_REVIEW });
}
