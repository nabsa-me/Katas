import { jwtVerify, SignJWT, type JWTPayload } from 'jose';
import { isRole, type Role } from '../../lib/roles';

/** What the app keeps about the signed-in user. The provider's tokens never leave the server. */
export interface SessionUser {
  sub: string;
  name: string;
  roles: Role[];
}

/** State of a login in progress, from `/api/auth/login` to `/api/auth/callback`. */
export interface LoginTransaction {
  codeVerifier: string;
  state: string;
  nonce: string;
  returnTo: string;
}

export const SESSION_COOKIE = 'session';
export const TRANSACTION_COOKIE = 'oidc_tx';
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
export const TRANSACTION_MAX_AGE_SECONDS = 10 * 60;

/**
 * - `httpOnly`: no script can read the cookie, so an XSS bug cannot steal the session.
 * - `secure`: sent only over HTTPS. Chromium also accepts it on `http://localhost`, which the local
 *   end-to-end tests rely on.
 * - `sameSite: 'lax'`: not sent on cross-site subrequests or form posts (CSRF), but sent on top-level
 *   navigations, which the redirect back from the provider is.
 */
export function cookieOptions(maxAgeSeconds: number) {
  return { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: maxAgeSeconds } as const;
}

// Distinct `typ` headers: a login-transaction token can never be replayed as a session, or the reverse.
const SESSION_TYPE = 'session+jwt';
const TRANSACTION_TYPE = 'oidc-transaction+jwt';

export function sealSession(user: SessionUser, secret: Uint8Array): Promise<string> {
  return seal({ name: user.name, roles: user.roles }, user.sub, SESSION_TYPE, SESSION_MAX_AGE_SECONDS, secret);
}

/** The session user, or `null` when the cookie is missing, tampered with, expired or malformed. */
export async function openSession(
  token: string | undefined,
  secret: Uint8Array,
  now?: Date,
): Promise<SessionUser | null> {
  const payload = await open(token, SESSION_TYPE, secret, now);
  if (!payload || typeof payload.sub !== 'string' || typeof payload.name !== 'string') return null;
  if (!Array.isArray(payload.roles) || !payload.roles.every(isRole)) return null;
  return { sub: payload.sub, name: payload.name, roles: payload.roles };
}

export function sealTransaction(transaction: LoginTransaction, secret: Uint8Array): Promise<string> {
  return seal({ ...transaction }, undefined, TRANSACTION_TYPE, TRANSACTION_MAX_AGE_SECONDS, secret);
}

export async function openTransaction(token: string | undefined, secret: Uint8Array): Promise<LoginTransaction | null> {
  const payload = await open(token, TRANSACTION_TYPE, secret);
  const { codeVerifier, state, nonce, returnTo } = payload ?? {};
  if (typeof codeVerifier !== 'string' || typeof state !== 'string') return null;
  if (typeof nonce !== 'string' || typeof returnTo !== 'string') return null;
  return { codeVerifier, state, nonce, returnTo };
}

function seal(
  claims: JWTPayload,
  subject: string | undefined,
  type: string,
  maxAgeSeconds: number,
  secret: Uint8Array,
): Promise<string> {
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256', typ: type })
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`);
  if (subject) jwt.setSubject(subject);
  return jwt.sign(secret);
}

async function open(
  token: string | undefined,
  type: string,
  secret: Uint8Array,
  now?: Date,
): Promise<JWTPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'], typ: type, currentDate: now });
    return payload;
  } catch {
    // Bad signature, wrong type, expired or not a JWT at all: for the app it is simply "no session".
    return null;
  }
}
