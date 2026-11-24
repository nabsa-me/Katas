import * as client from 'openid-client';
import { rolesFromGroups } from '../../lib/roles';
import { getConfig } from './config';
import type { LoginTransaction, SessionUser } from './session';

export const CALLBACK_PATH = '/api/auth/callback';
export const POST_LOGOUT_PATH = '/oidc-nextjs';

let discovered: Promise<client.Configuration> | undefined;

/** Reads the provider's discovery document once per server process (and again if it failed). */
function oidcConfiguration(): Promise<client.Configuration> {
  const { issuer, clientId } = getConfig();
  discovered ??= client
    .discovery(issuer, clientId, undefined, client.None(), {
      // openid-client refuses plain http. The local mock has no TLS, and `parseConfig` only lets
      // http through for localhost, so this opt-out never reaches a real provider.
      execute: issuer.protocol === 'http:' ? [client.allowInsecureRequests] : [],
    })
    .catch((error: unknown) => {
      discovered = undefined;
      throw error;
    });
  return discovered;
}

function callbackUrl(): URL {
  return new URL(CALLBACK_PATH, getConfig().appUrl);
}

/**
 * Authorization Code flow with PKCE (S256), `state` and `nonce`. The client is public (no secret): PKCE
 * binds the code to this login, `state` binds the callback to this browser, `nonce` binds the ID token.
 */
export async function startLogin(returnTo: string): Promise<{ authorizationUrl: URL; transaction: LoginTransaction }> {
  const codeVerifier = client.randomPKCECodeVerifier();
  const transaction = { codeVerifier, state: client.randomState(), nonce: client.randomNonce(), returnTo };
  const authorizationUrl = client.buildAuthorizationUrl(await oidcConfiguration(), {
    redirect_uri: callbackUrl().href,
    scope: 'openid profile',
    code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: 'S256',
    state: transaction.state,
    nonce: transaction.nonce,
  });
  return { authorizationUrl, transaction };
}

/**
 * Exchanges the code on the server and validates the ID token (signature, `iss`, `aud`/`azp`, `exp`,
 * `nonce`). The callback URL is rebuilt from `APP_URL`, not from the Host header, because openid-client
 * derives the `redirect_uri` it sends to the token endpoint from it.
 */
export async function completeLogin(callbackSearch: string, transaction: LoginTransaction): Promise<SessionUser> {
  const currentUrl = new URL(`${CALLBACK_PATH}${callbackSearch}`, getConfig().appUrl);
  const tokens = await client.authorizationCodeGrant(await oidcConfiguration(), currentUrl, {
    pkceCodeVerifier: transaction.codeVerifier,
    expectedState: transaction.state,
    expectedNonce: transaction.nonce,
    idTokenExpected: true,
  });
  const claims = tokens.claims();
  if (!claims) throw new Error('The provider returned no ID token');
  return {
    sub: claims.sub,
    name: typeof claims.name === 'string' ? claims.name : claims.sub,
    roles: rolesFromGroups(claims.groups),
  };
}

/** RP-initiated logout: the provider ends its own session and sends the browser back to the app. */
export async function endSessionUrl(): Promise<URL> {
  return client.buildEndSessionUrl(await oidcConfiguration(), {
    post_logout_redirect_uri: new URL(POST_LOGOUT_PATH, getConfig().appUrl).href,
  });
}
