import { UnsecuredJWT } from 'jose';
import * as client from 'openid-client';
import { LOCAL_SERVICES } from '../../lib/local-services';

/**
 * Prints a token to call the demo API with curl:
 * - `npm run token -- ada` (admins) or `npm run token -- grace` (readers): a real access token from the
 *   mock provider. It submits the provider's login form without a browser (any username works), with PKCE.
 * - `npm run token -- --unsigned`: a forged admin token with `alg: none`, accepted only by `npm run api -- --problem`.
 */
const issuer = process.env.OIDC_ISSUER ?? LOCAL_SERVICES.issuer;
const args = process.argv.slice(2);

async function accessTokenFor(username: string): Promise<string> {
  const config = await client.discovery(new URL(issuer), 'katas-web', undefined, client.None(), {
    // The local mock speaks plain http; openid-client refuses it unless told otherwise.
    execute: issuer.startsWith('http:') ? [client.allowInsecureRequests] : [],
  });
  const codeVerifier = client.randomPKCECodeVerifier();
  const state = client.randomState();
  const authorizationUrl = client.buildAuthorizationUrl(config, {
    // Never visited: the code is read from the provider's redirect.
    redirect_uri: `${LOCAL_SERVICES.appUrl}/api/auth/callback`,
    scope: 'openid',
    code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: 'S256',
    state,
  });
  // What the browser sends when the user submits the mock provider's login form.
  const login = await fetch(authorizationUrl, {
    method: 'POST',
    body: new URLSearchParams({ username, claims: '' }),
    redirect: 'manual',
  });
  const location = login.headers.get('location');
  if (!location) throw new Error(`The provider did not redirect after the login (status ${login.status})`);
  const tokens = await client.authorizationCodeGrant(config, new URL(location), {
    pkceCodeVerifier: codeVerifier,
    expectedState: state,
  });
  return tokens.access_token;
}

if (args.includes('--unsigned')) {
  const forged = new UnsecuredJWT({ groups: ['katas-admins'] }).setSubject('mallory');
  console.log(forged.setIssuer(issuer).setAudience('katas-api').setExpirationTime('1h').encode());
} else {
  console.log(await accessTokenFor(args[0] ?? 'ada'));
}
