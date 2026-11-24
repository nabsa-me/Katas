# JWT validation in the API

## Statement

An internal API receives `Authorization: Bearer <access token>` from apps that sign users in with the company's OpenID Connect provider. Its middleware reads the caller and their groups from the token:

```ts
import { decodeJwt } from 'jose';

const payload = decodeJwt(token);
const isAdmin = Array.isArray(payload.groups) && payload.groups.includes('katas-admins');
```

Symptom: a token written by hand, with `alg: none` and `"groups": ["katas-admins"]`, gets the admin report. So does a token that expired last week, one issued for another API, one from another provider and one signed with a key the provider never published.

Write the middleware that verifies the token with `jose`: `createRemoteJWKSet` for the provider's public keys and `jwtVerify` checking `iss`, `aud`, `exp` and an allow-list of algorithms, answering 401 with a `WWW-Authenticate` header when the token is missing or invalid, plus a `requireRole('admin')` that answers 403.

## What gets assessed

- The difference between decoding a JWT and verifying it, and what each claim check prevents.
- Why the server, not the token's header, chooses the algorithm: `alg: none` and algorithm confusion.
- Where the keys come from: the JWKS from discovery, cached, and refetched when a new `kid` appears (key rotation).
- 401 versus 403, and the `WWW-Authenticate` challenge of RFC 6750.
- Tests that create their own keys and serve their own JWKS: no fixed keys or tokens in the repository.

## How to approach it, step by step

1. Look at a real token: `npm run token -- ada` prints one. Decode it locally, never on a third-party website: `node -e "console.log(JSON.parse(Buffer.from(process.argv[1].split('.')[1], 'base64url')))" <token>`.
2. Read the discovery document (`http://localhost:5806/katas/.well-known/openid-configuration`): `issuer`, `jwks_uri` and the signing algorithms the provider uses.
3. Write the verifier: one `createRemoteJWKSet` per process, `jwtVerify` with `issuer`, `audience`, `algorithms` and the claims that must be present.
4. Wrap it in an `authenticate` middleware: read the Bearer token, 401 when it is missing or invalid, and the verified claims passed on to the handler.
5. Add `requireRole(role)` on top: 403 when the authenticated caller lacks it.
6. Test it: a test issuer with a fresh key pair and a JWKS server; one test per attack, and the same attacks against the flawed version to show what it lets through.

## Solution explained

[`verify-access-token.ts`](./verify-access-token.ts) is the verifier, [`middleware.ts`](./middleware.ts) holds `authenticate` and `requireRole`, and [`app.ts`](./app.ts) wires two routes on plain `node:http`: `GET /me` (any valid caller) and `GET /admin/report` (admins). [`server.ts`](./server.ts) starts it on port 5805 (`npm run api`). The flawed verifier is [`verify-access-token.problem.ts`](./verify-access-token.problem.ts); `npm run api -- --problem` runs the same API with it.

**Decoding is not verifying.** A JWT is `header.payload.signature`, each part base64url. Anyone can write the first two parts: `decodeJwt` only reads the payload, so the claims are whatever the caller typed. Only the signature, checked with a key the provider published, proves who issued the token and that nothing changed since.

**The verifier.**

```ts
const jwks = createRemoteJWKSet(jwksUri);

const { payload } = await jwtVerify(token, jwks, {
  issuer,
  audience,
  algorithms: ['RS256'],
  requiredClaims: ['sub', 'exp'],
  clockTolerance: '30s',
});
```

- `createRemoteJWKSet` downloads the provider's public keys on first use and caches them (10 minutes by default). A token whose `kid` is not in the cache triggers a refetch, which is how key rotation works without restarts; the 30-second cooldown stops a flood of tokens with invented `kid`s from hammering the provider. Create it once, not per request.
- `algorithms: ['RS256']` is the allow-list. The `alg` in the header is chosen by whoever wrote the token; the server decides what it accepts.
- `issuer` must match exactly: a correctly signed token from another tenant or another provider is still not ours.
- `audience` names this API. Without it, a token the same provider issued for another API (or for another app) works here too.
- `exp` is checked whenever it is present; `requiredClaims` makes it mandatory, because a token without `exp` would never expire. `clockTolerance` absorbs small clock differences between servers.

**`alg: none`.** An unsecured JWT has an empty signature. With the allow-list, `jose` rejects it before looking for a key (`ERR_JOSE_ALG_NOT_ALLOWED`); without it, `jwtVerify` still refuses it (`ERR_JOSE_NOT_SUPPORTED`). Libraries that accepted `none` are the reason this check is on every review list.

**Algorithm confusion.** The attacker takes the provider's public key (it is public), uses it as an HMAC secret and signs a token with `alg: HS256`. A verifier that is handed the key as a PEM and lets the header choose the algorithm computes the same HMAC and accepts it. With the allow-list the token is rejected as soon as its header is read. `jose` key sets refuse symmetric algorithms anyway, and [`verify-access-token.test.ts`](./verify-access-token.test.ts) shows both: the key set rejects the token, and a verifier given the PEM bytes accepts it.

**Access token or ID token.** The API must accept access tokens issued for it, not ID tokens issued to a web app. `aud` usually separates them. Access tokens that follow RFC 9068 also carry the header `typ: at+jwt`, which `jwtVerify` can require with its `typ` option; the mock provider signs both kinds with `typ: JWT` and puts the same `aud` list (`katas-web`, `katas-api`) in both, so this check is left out here.

**401 or 403.** `authenticate` answers 401 when there is no valid token, with the RFC 6750 challenge: `WWW-Authenticate: Bearer realm="katas-api"` when the request has no credentials and `Bearer realm="katas-api", error="invalid_token"` when it has a bad one. `requireRole('admin')` answers 403: the caller is known, the role is missing. Only `jose` validation errors become 401; any other failure (the JWKS endpoint unreachable, for example) becomes a 500, so an outage does not look like every user's token went bad.

**Roles from verified claims only.** The principal passed to the handlers holds `sub` and the roles from [`rolesFromGroups`](../../lib/roles.ts), the same explicit mapping the Next.js exercise uses, built after verification.

**Where the key URL comes from.** [`server.ts`](./server.ts) reads the discovery document, checks that its `issuer` is the one configured and only then takes `jwks_uri`. Environment: `OIDC_ISSUER` (default `http://localhost:5806/katas`) and `API_AUDIENCE` (default `katas-api`).

**Trying it.** With the mock provider up:

```bash
npm run api                                   # solution on http://localhost:5805
TOKEN=$(npm run -s token -- grace)            # a real access token for grace (readers group)
curl -i http://localhost:5805/me -H "Authorization: Bearer $TOKEN"            # 200 {"sub":"grace","roles":["reader"]}
curl -i http://localhost:5805/admin/report -H "Authorization: Bearer $TOKEN"  # 403
FORGED=$(npm run -s token -- --unsigned)      # alg: none, claims to be an admin
curl -i http://localhost:5805/admin/report -H "Authorization: Bearer $FORGED" # 401 invalid_token
```

With `npm run api -- --problem` the forged token gets the report with 200.

**How it is proven.** No fixed keys or tokens: [`test-issuer.ts`](./test-issuer.ts) creates an RS256 key pair with `generateKeyPair('RS256', { extractable: true })` and serves its JWKS from a real `node:http` server on an ephemeral port, so the verifier fetches keys exactly as it does in production. [`verify-access-token.test.ts`](./verify-access-token.test.ts) accepts a valid token (and one expired within the tolerance) and rejects, each with its `jose` error code, an unsigned token, an expired one, one with the wrong `aud`, one with the wrong `iss`, one signed with another key under the published `kid`, an HS256 token signed with the public key and one without `exp`; the same table run against the problem shows `decodeJwt` accepting every one. [`app.test.ts`](./app.test.ts) checks the HTTP layer: 401 with each challenge, 200 for `/me`, 403 for a reader and 200 for an admin on `/admin/report`, and the problem API serving the report to a forged token.

## Common mistakes

| Symptom                                                               | Cause                                                                                          |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Hand-written tokens are accepted                                      | `decodeJwt` (or `jwt.decode`) used where `jwtVerify` (or `jwt.verify`) was needed.             |
| A token issued for another API works here                             | `audience` not checked.                                                                        |
| Tokens from a test tenant work in production                          | `issuer` not checked, or checked with `startsWith`.                                            |
| HS256 tokens signed with the public key are accepted                  | No algorithm allow-list, and a library that uses the header's `alg` with the key it was given. |
| Every request fails for a few minutes after the provider rotates keys | Keys loaded once at startup instead of a key set that refetches on an unknown `kid`.           |
| The provider gets one JWKS request per API request                    | `createRemoteJWKSet` created inside the handler, so nothing is cached.                         |
| Clients drop valid tokens when the provider is down                   | Every verification error mapped to 401, including network failures to the JWKS endpoint.       |
| A reader gets 401 on the admin route and retries the login            | Missing role answered with 401 instead of 403.                                                 |

## Practice

Add per-route scopes: require `scope` to contain `reports:read` on `GET /admin/report` with a `requireScope` middleware, answer 403 with `WWW-Authenticate: Bearer error="insufficient_scope", scope="reports:read"`, and add the mapping in the mock provider's `docker-compose.yml`.
