import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import {
  cookieOptions,
  openSession,
  openTransaction,
  sealSession,
  sealTransaction,
  SESSION_MAX_AGE_SECONDS,
  type SessionUser,
} from './session';

const secret = new TextEncoder().encode('a-test-secret-that-is-long-enough-123');
const otherSecret = new TextEncoder().encode('another-secret-that-is-long-enough-456');
const ada: SessionUser = { sub: 'ada', name: 'Ada Lovelace', roles: ['admin'] };
const transaction = { codeVerifier: 'verifier', state: 'state', nonce: 'nonce', returnTo: '/admin' };

describe('session token', () => {
  it('round-trips the user', async () => {
    expect(await openSession(await sealSession(ada, secret), secret)).toEqual(ada);
  });

  it('is rejected when signed with another secret', async () => {
    expect(await openSession(await sealSession(ada, otherSecret), secret)).toBeNull();
  });

  it('is rejected when the payload was edited, for example to add a role', async () => {
    const [header, , signature] = (await sealSession({ ...ada, roles: ['reader'] }, secret)).split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ sub: 'ada', name: 'Ada', roles: ['admin'] })).toString(
      'base64url',
    );
    expect(await openSession(`${header}.${forgedPayload}.${signature}`, secret)).toBeNull();
  });

  it('expires after eight hours', async () => {
    const token = await sealSession(ada, secret);
    const justBefore = new Date(Date.now() + (SESSION_MAX_AGE_SECONDS - 60) * 1000);
    const justAfter = new Date(Date.now() + (SESSION_MAX_AGE_SECONDS + 60) * 1000);
    expect(await openSession(token, secret, justBefore)).toEqual(ada);
    expect(await openSession(token, secret, justAfter)).toBeNull();
  });

  it('is rejected when missing or not a JWT', async () => {
    expect(await openSession(undefined, secret)).toBeNull();
    expect(await openSession('not-a-jwt', secret)).toBeNull();
  });

  it('is rejected when a correctly signed payload has unknown roles', async () => {
    const token = await new SignJWT({ name: 'Mallory', roles: ['root'] })
      .setProtectedHeader({ alg: 'HS256', typ: 'session+jwt' })
      .setSubject('mallory')
      .setExpirationTime('1h')
      .sign(secret);
    expect(await openSession(token, secret)).toBeNull();
  });

  it('cannot be confused with a login-transaction token signed with the same secret', async () => {
    expect(await openSession(await sealTransaction(transaction, secret), secret)).toBeNull();
    expect(await openTransaction(await sealSession(ada, secret), secret)).toBeNull();
  });
});

describe('login-transaction token', () => {
  it('round-trips the PKCE verifier, state, nonce and return path', async () => {
    expect(await openTransaction(await sealTransaction(transaction, secret), secret)).toEqual(transaction);
  });

  it('is rejected when signed with another secret', async () => {
    expect(await openTransaction(await sealTransaction(transaction, otherSecret), secret)).toBeNull();
  });
});

describe('cookieOptions', () => {
  it('keeps the cookie away from scripts, off plain http and off cross-site posts', () => {
    expect(cookieOptions(60)).toEqual({ httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 });
  });
});
