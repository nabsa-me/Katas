import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWTPayload } from 'jose';

export const TEST_AUDIENCE = 'katas-api';
const KID = 'test-key-1';

export interface SignOptions {
  /** Signing key; defaults to the issuer's private key (the one published in the JWKS). */
  key?: CryptoKey | Uint8Array;
  alg?: string;
  issuer?: string;
  audience?: string;
  /** `exp` as seconds since the epoch; defaults to five minutes from now. `null` leaves it out. */
  expiresAt?: number | null;
}

export interface TestIssuer {
  issuer: string;
  jwksUri: URL;
  publicKey: CryptoKey;
  sign(claims: JWTPayload, options?: SignOptions): Promise<string>;
  close(): Promise<void>;
}

/**
 * A stand-in for the identity provider in tests: a fresh RS256 key pair and a real HTTP server on an
 * ephemeral port that publishes the public key as a JWKS, so the verifier fetches keys exactly as it
 * does in production. No fixed keys or tokens are stored in the repository.
 */
export async function startTestIssuer(): Promise<TestIssuer> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: KID, alg: 'RS256', use: 'sig' }] };

  const server = createServer((req, res) => {
    const found = req.url === '/katas/jwks';
    res.writeHead(found ? 200 : 404, { 'content-type': 'application/json' });
    res.end(found ? JSON.stringify(jwks) : '{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const issuer = `http://127.0.0.1:${port}/katas`;

  return {
    issuer,
    jwksUri: new URL(`${issuer}/jwks`),
    publicKey,
    sign(claims, options = {}) {
      const { key = privateKey, alg = 'RS256', expiresAt = Math.floor(Date.now() / 1000) + 300 } = options;
      const jwt = new SignJWT(claims)
        .setProtectedHeader({ alg, kid: KID, typ: 'JWT' })
        .setIssuer(options.issuer ?? issuer)
        .setAudience(options.audience ?? TEST_AUDIENCE)
        .setIssuedAt();
      if (expiresAt !== null) jwt.setExpirationTime(expiresAt);
      return jwt.sign(key);
    },
    close() {
      server.closeAllConnections();
      return new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}
