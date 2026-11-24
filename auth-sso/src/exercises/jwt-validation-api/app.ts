import type { RequestListener } from 'node:http';
import { authenticate, requireRole, sendJson, type Handler } from './middleware';
import type { VerifyAccessToken } from './verify-access-token';

/** Fictional data that only admins may read. */
const DEPLOYMENT_APPROVALS = [
  { service: 'billing', approvedBy: 'ada', date: '2026-11-20' },
  { service: 'search', approvedBy: 'ada', date: '2026-11-21' },
];

/**
 * A framework-free API, so each step is visible: route, authenticate, authorize, respond.
 * The verifier is injected: the server passes the real one, the tests pass it too (or the flawed one).
 */
export function createApi(verify: VerifyAccessToken): RequestListener {
  const routes: Record<string, Handler> = {
    'GET /me': authenticate(verify, async (_req, res, principal) => sendJson(res, 200, principal)),
    'GET /admin/report': authenticate(
      verify,
      requireRole('admin', async (_req, res) => sendJson(res, 200, { approvals: DEPLOYMENT_APPROVALS })),
    ),
  };

  return (req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://api.invalid');
    const handler = routes[`${req.method} ${pathname}`];
    if (!handler) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    handler(req, res).catch((error: unknown) => {
      console.error('Request failed', error);
      if (!res.headersSent) sendJson(res, 500, { error: 'internal_error' });
    });
  };
}
