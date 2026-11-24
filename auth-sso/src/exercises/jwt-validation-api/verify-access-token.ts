import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

/** Returns the verified claims, or rejects with a `jose` error saying which check failed. */
export type VerifyAccessToken = (token: string) => Promise<JWTPayload>;

export interface AccessTokenPolicy {
  /** Exact `iss` of the provider, as in its discovery document. */
  issuer: string;
  /** This API's identifier: tokens issued for any other API or client are refused. */
  audience: string;
  /** The provider's public keys (`jwks_uri` from discovery). */
  jwksUri: URL;
}

/**
 * Every check that `decodeJwt` skips: the signature against the provider's published keys, an allow-list
 * of algorithms (never the one the token's header asks for), `iss`, `aud`, and `exp`, which is required
 * so that a token without it does not live forever.
 */
export function createAccessTokenVerifier({ issuer, audience, jwksUri }: AccessTokenPolicy): VerifyAccessToken {
  // Downloaded on first use and cached. A token whose `kid` is not in the cache triggers one refetch
  // (key rotation), rate-limited so garbage tokens cannot make the API hammer the provider.
  const jwks = createRemoteJWKSet(jwksUri);

  return async (token) => {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience,
      algorithms: ['RS256'],
      requiredClaims: ['sub', 'exp'],
      // Tolerates small clock differences between the provider and this server.
      clockTolerance: '30s',
    });
    return payload;
  };
}
