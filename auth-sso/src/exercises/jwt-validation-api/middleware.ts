import type { IncomingMessage, ServerResponse } from 'node:http';
import { errors } from 'jose';
import { rolesFromGroups, type Role } from '../../lib/roles';
import type { VerifyAccessToken } from './verify-access-token';

/** Who is calling, built only from verified claims. */
export interface Principal {
  sub: string;
  roles: Role[];
}

export type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;
export type AuthenticatedHandler = (req: IncomingMessage, res: ServerResponse, principal: Principal) => Promise<void>;

const REALM = 'katas-api';

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

/** The token from `Authorization: Bearer <token>`, or `null` when the header is missing or has another scheme. */
export function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer ([\w\-.~+/]+=*)$/i.exec(header ?? '');
  return match?.[1] ?? null;
}

/**
 * 401 when there is no valid token, following RFC 6750: no error code when the request has no
 * credentials, `error="invalid_token"` when it has a bad one. Only `jose` validation errors mean
 * "bad token"; anything else (the provider's JWKS endpoint down, for example) is a server error.
 */
export function authenticate(verify: VerifyAccessToken, next: AuthenticatedHandler): Handler {
  return async (req, res) => {
    const token = bearerToken(req.headers.authorization);
    if (!token) {
      return sendJson(res, 401, { error: 'unauthenticated' }, { 'www-authenticate': `Bearer realm="${REALM}"` });
    }
    let payload;
    try {
      payload = await verify(token);
    } catch (error) {
      if (!(error instanceof errors.JOSEError)) throw error;
      const challenge = `Bearer realm="${REALM}", error="invalid_token"`;
      return sendJson(res, 401, { error: 'invalid_token' }, { 'www-authenticate': challenge });
    }
    const sub = typeof payload.sub === 'string' ? payload.sub : 'unknown';
    await next(req, res, { sub, roles: rolesFromGroups(payload.groups) });
  };
}

/** 403: the caller is authenticated but lacks the role. Checked on every request, by the API itself. */
export function requireRole(role: Role, next: AuthenticatedHandler): AuthenticatedHandler {
  return async (req, res, principal) => {
    if (!principal.roles.includes(role)) return sendJson(res, 403, { error: 'forbidden' });
    await next(req, res, principal);
  };
}
