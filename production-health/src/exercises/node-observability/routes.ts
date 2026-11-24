/**
 * Route templates, not paths. Logs, metrics and alarms use the template (`/issues/:key`): with the path
 * (`/issues/PLAT-1`, `/issues/PLAT-2`…) every issue would become its own metric, each one billed and alarmed alone.
 */
export const ROUTES = ['/healthz', '/readyz', '/issues', '/issues/:key'] as const;
export type Route = (typeof ROUTES)[number];

/** Anything that matches no route is counted under one name, whatever the path a scanner tries. */
export const UNMATCHED_ROUTE = 'unmatched';

/** The routes that serve users, and therefore the ones with latency and error-rate alarms. */
export const USER_ROUTES: readonly Route[] = ['/issues', '/issues/:key'];

export interface RouteMatch {
  route: Route;
  params: Record<string, string>;
}

const ISSUE_PATH = /^\/issues\/([^/]+)$/;

/**
 * Matches the path only; the caller checks the method, so a POST to a known route can answer 405. Parameters stay
 * as sent (no `decodeURIComponent`, which throws on a malformed `%`): the handler validates them against a pattern.
 */
export function matchRoute(pathname: string): RouteMatch | undefined {
  if (pathname === '/healthz' || pathname === '/readyz' || pathname === '/issues') {
    return { route: pathname, params: {} };
  }
  const issue = ISSUE_PATH.exec(pathname);
  if (issue?.[1]) return { route: '/issues/:key', params: { key: issue[1] } };
  return undefined;
}
