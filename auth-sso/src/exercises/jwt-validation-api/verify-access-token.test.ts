import { createRemoteJWKSet, exportSPKI, generateKeyPair, jwtVerify, UnsecuredJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestIssuer, TEST_AUDIENCE, type TestIssuer } from './test-issuer';
import { createAccessTokenVerifier, type VerifyAccessToken } from './verify-access-token';
import { problemVerifyAccessToken } from './verify-access-token.problem';

let idp: TestIssuer;
let verify: VerifyAccessToken;

beforeAll(async () => {
  idp = await startTestIssuer();
  verify = createAccessTokenVerifier({ issuer: idp.issuer, audience: TEST_AUDIENCE, jwksUri: idp.jwksUri });
});

afterAll(() => idp.close());

const admin = { sub: 'mallory', groups: ['katas-admins'] };
const now = () => Math.floor(Date.now() / 1000);

/** Tokens an attacker can make or replay, with the `jose` error code the verifier rejects each with. */
const attacks: [name: string, makeToken: () => Promise<string>, code: string][] = [
  [
    'an unsigned token (alg: none)',
    async () =>
      new UnsecuredJWT(admin).setIssuer(idp.issuer).setAudience(TEST_AUDIENCE).setExpirationTime('5m').encode(),
    'ERR_JOSE_ALG_NOT_ALLOWED',
  ],
  ['an expired token', () => idp.sign(admin, { expiresAt: now() - 120 }), 'ERR_JWT_EXPIRED'],
  [
    'a token for another audience',
    () => idp.sign(admin, { audience: 'billing-api' }),
    'ERR_JWT_CLAIM_VALIDATION_FAILED',
  ],
  [
    'a token from another issuer',
    () => idp.sign(admin, { issuer: 'https://idp.example.com/realms/other' }),
    'ERR_JWT_CLAIM_VALIDATION_FAILED',
  ],
  [
    'a token signed with another key that claims the published kid',
    async () => idp.sign(admin, { key: (await generateKeyPair('RS256')).privateKey }),
    'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
  ],
  [
    'an HS256 token signed with the public key as the HMAC secret (algorithm confusion)',
    async () => idp.sign(admin, { alg: 'HS256', key: new TextEncoder().encode(await exportSPKI(idp.publicKey)) }),
    'ERR_JOSE_ALG_NOT_ALLOWED',
  ],
  [
    'a token without exp, which would never expire',
    () => idp.sign(admin, { expiresAt: null }),
    'ERR_JWT_CLAIM_VALIDATION_FAILED',
  ],
];

describe('solution: createAccessTokenVerifier', () => {
  it('accepts a token signed by the provider for this API, and returns its claims', async () => {
    const payload = await verify(await idp.sign({ sub: 'ada', groups: ['katas-admins'] }));
    expect(payload).toMatchObject({ sub: 'ada', groups: ['katas-admins'], iss: idp.issuer, aud: TEST_AUDIENCE });
  });

  it('accepts a token that expired within the clock tolerance', async () => {
    await expect(verify(await idp.sign({ sub: 'ada' }, { expiresAt: now() - 10 }))).resolves.toBeDefined();
  });

  it.each(attacks)('rejects %s', async (_name, makeToken, code) => {
    await expect(verify(await makeToken())).rejects.toMatchObject({ code });
  });
});

describe('problem: decodeJwt', () => {
  it.each(attacks)('accepts %s', async (_name, makeToken) => {
    await expect(problemVerifyAccessToken(await makeToken())).resolves.toMatchObject({ groups: ['katas-admins'] });
  });
});

describe('what the algorithm allow-list adds', () => {
  it('jose never verifies alg: none, even without an allow-list', async () => {
    const token = new UnsecuredJWT(admin).encode();
    await expect(jwtVerify(token, createRemoteJWKSet(idp.jwksUri))).rejects.toMatchObject({
      code: 'ERR_JOSE_NOT_SUPPORTED',
    });
  });

  it('jose key sets refuse symmetric algorithms, but a verifier handed the PEM lets the header choose', async () => {
    const secret = new TextEncoder().encode(await exportSPKI(idp.publicKey));
    const token = await idp.sign(admin, { alg: 'HS256', key: secret });
    await expect(jwtVerify(token, createRemoteJWKSet(idp.jwksUri))).rejects.toMatchObject({
      code: 'ERR_JOSE_NOT_SUPPORTED',
    });
    // A verifier handed the PEM itself, with no allow-list, would accept it: the token's header chose HMAC.
    await expect(jwtVerify(token, secret)).resolves.toBeDefined();
  });
});
