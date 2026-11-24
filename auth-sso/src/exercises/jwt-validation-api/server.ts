import { createServer } from 'node:http';
import { LOCAL_SERVICES } from '../../lib/local-services';
import { createApi } from './app';
import { createAccessTokenVerifier } from './verify-access-token';
import { problemVerifyAccessToken } from './verify-access-token.problem';

// `npm run api` runs the solution; `npm run api -- --problem` runs the flawed verifier for comparison.
const issuer = process.env.OIDC_ISSUER ?? LOCAL_SERVICES.issuer;
const audience = process.env.API_AUDIENCE ?? 'katas-api';
const flawed = process.argv.includes('--problem');

/** The provider's discovery document is external data: check it before trusting the key URL in it. */
async function discoverJwksUri(): Promise<URL> {
  const discovery = `${issuer}/.well-known/openid-configuration`;
  const response = await fetch(discovery).catch(() => null);
  if (!response?.ok) throw new Error(`No discovery document at ${discovery}. Start it: docker compose up -d --wait`);
  const metadata = (await response.json()) as { issuer?: unknown; jwks_uri?: unknown };
  if (metadata.issuer !== issuer) throw new Error(`Discovery returned issuer ${String(metadata.issuer)}`);
  if (typeof metadata.jwks_uri !== 'string') throw new Error('Discovery returned no jwks_uri');
  return new URL(metadata.jwks_uri);
}

const verify = flawed
  ? problemVerifyAccessToken
  : createAccessTokenVerifier({ issuer, audience, jwksUri: await discoverJwksUri() });

const { port } = new URL(LOCAL_SERVICES.apiUrl);
createServer(createApi(verify)).listen(Number(port), 'localhost', () => {
  console.log(`Demo API (${flawed ? 'problem' : 'solution'}) on ${LOCAL_SERVICES.apiUrl}: GET /me, GET /admin/report`);
});
