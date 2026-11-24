import { decodeJwt, type JWTPayload } from 'jose';

/**
 * BUG: `decodeJwt` only base64-decodes the payload. Nothing checks the signature, so anyone can write
 * `{"sub":"mallory","groups":["katas-admins"]}` with `alg: none`; nothing checks the algorithm, `iss`,
 * `aud` or `exp`, so a token from another provider, for another API or expired last year is accepted.
 */
export async function problemVerifyAccessToken(token: string): Promise<JWTPayload> {
  return decodeJwt(token);
}
