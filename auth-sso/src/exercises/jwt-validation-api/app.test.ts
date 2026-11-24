import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { UnsecuredJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from './app';
import { bearerToken } from './middleware';
import { startTestIssuer, TEST_AUDIENCE, type TestIssuer } from './test-issuer';
import { createAccessTokenVerifier, type VerifyAccessToken } from './verify-access-token';
import { problemVerifyAccessToken } from './verify-access-token.problem';

let idp: TestIssuer;
const servers: Server[] = [];

/** Starts the API on an ephemeral port and returns its base URL. */
async function startApi(verify: VerifyAccessToken): Promise<string> {
  const server = createServer(createApi(verify));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function get(url: string, token?: string): Promise<Response> {
  return fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
}

let solution: string;
let problem: string;

beforeAll(async () => {
  idp = await startTestIssuer();
  solution = await startApi(
    createAccessTokenVerifier({ issuer: idp.issuer, audience: TEST_AUDIENCE, jwksUri: idp.jwksUri }),
  );
  problem = await startApi(problemVerifyAccessToken);
});

afterAll(async () => {
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
  await idp.close();
});

const forged = () =>
  new UnsecuredJWT({ groups: ['katas-admins'] }).setSubject('mallory').setExpirationTime('5m').encode();

describe('solution API', () => {
  it('answers 401 with a bare Bearer challenge when there is no token', async () => {
    const response = await get(`${solution}/me`);
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer realm="katas-api"');
  });

  it('answers 401 invalid_token to a forged token', async () => {
    const response = await get(`${solution}/admin/report`, forged());
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer realm="katas-api", error="invalid_token"');
  });

  it('identifies a valid caller and maps groups to roles', async () => {
    const response = await get(`${solution}/me`, await idp.sign({ sub: 'grace', groups: ['katas-readers'] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sub: 'grace', roles: ['reader'] });
  });

  it('answers 403 to a valid reader on the admin route: requireRole("admin")', async () => {
    const response = await get(`${solution}/admin/report`, await idp.sign({ sub: 'grace', groups: ['katas-readers'] }));
    expect(response.status).toBe(403);
  });

  it('serves the admin route to a valid admin', async () => {
    const response = await get(`${solution}/admin/report`, await idp.sign({ sub: 'ada', groups: ['katas-admins'] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ approvals: expect.any(Array) });
  });

  it('answers 404 to unknown routes', async () => {
    expect((await get(`${solution}/nothing-here`)).status).toBe(404);
  });
});

describe('problem API', () => {
  it('serves the admin route to a token anyone can write', async () => {
    const response = await get(`${problem}/admin/report`, forged());
    expect(response.status).toBe(200);
  });
});

describe('bearerToken', () => {
  it('reads the token only from a Bearer authorization header', () => {
    expect(bearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(bearerToken('bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(bearerToken('Basic dXNlcjpwYXNz')).toBeNull();
    expect(bearerToken('Bearer ')).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });
});
