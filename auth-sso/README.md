# auth-sso

Two katas on single sign-on with OpenID Connect, solved and explained: logging users in to a Next.js 16 app with the Authorization Code flow and PKCE, keeping the session in an `httpOnly` cookie and checking roles on the server; and validating access tokens in an API with `jose`. A mock OpenID Connect provider runs in Docker, so everything works locally with no real credentials.

## Run

Requires Node 22.12 or later and Docker. Ports: 5804 (Next.js app), 5805 (demo API), 5806 (mock provider).

```bash
cd auth-sso
npm install
docker compose up -d --wait     # mock OpenID Connect provider: http://localhost:5806/katas
cp .env.example .env.local      # then replace SESSION_SECRET (the placeholder is refused at startup)
npm run dev                     # Next.js dev server: http://localhost:5804
npm run build && npm run start  # production build on the same port
npm run api                     # demo API that validates access tokens: http://localhost:5805
npm run token -- ada            # prints an access token for ada (admins) or grace (readers)
npm test                        # unit and integration tests (Vitest, no Docker needed)
npx playwright install chromium # once, for the end-to-end tests
npm run e2e                     # Playwright against next build + next start; needs the mock provider
npm run check                   # type checking
docker compose down             # stop the mock provider
```

The home page lists the exercises. The statement, the explained solution and the common mistakes are in the `README.md` of each folder. In the mock provider's login form any username works: `ada` is in the `katas-admins` group, `grace` only in `katas-readers`.

## How to use these katas

1. Read the exercise statement (only the "Statement" section).
2. Try to solve it **yourself, in an empty project, without an assistant**. Official documentation only.
3. If you get stuck, read "How to approach it, step by step" and carry on.
4. When done, compare with the solution and read "Solution explained" and "Common mistakes".
5. Repeat the exercise another day without looking.

| Exercise                                                                | What it practises                                                                         |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [OIDC in Next.js](src/exercises/oidc-nextjs/README.md)                  | Code flow + PKCE on the server, `httpOnly` session, `proxy.ts`, server-side roles, logout |
| [JWT validation in the API](src/exercises/jwt-validation-api/README.md) | `jwtVerify` with a remote JWKS, `iss`/`aud`/`exp`, algorithm allow-list, 401 versus 403   |

## OpenID Connect cheat sheet

| I need…                                            | Use                                                                                            |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| To log users in to a web app                       | Authorization Code flow with PKCE, run by the server                                           |
| The provider's endpoints and keys                  | Discovery: `<issuer>/.well-known/openid-configuration` (`client.discovery` in openid-client)   |
| An intercepted code to be useless                  | PKCE: the `code_verifier` stays on the server, the provider gets the S256 `code_challenge`     |
| The callback to belong to this browser             | `state`, generated per login and checked in the callback                                       |
| The ID token to belong to this login               | `nonce`, sent in the authorization request and checked in the ID token                         |
| To know who the user is                            | The validated ID token: `(await client.authorizationCodeGrant(...)).claims()`                  |
| To keep the user signed in                         | A session cookie: `httpOnly`, `Secure`, `SameSite=Lax`, signed                                 |
| To call an API as the user                         | The access token, kept on the server (encrypted cookie or session store), never in the browser |
| To validate a token in an API                      | `jwtVerify(token, createRemoteJWKSet(jwksUri), { issuer, audience, algorithms })`              |
| To look inside a token while debugging             | `decodeJwt`, locally; never for decisions                                                      |
| To answer an API call without a valid token        | 401 with `WWW-Authenticate: Bearer realm="…"` (plus `error="invalid_token"` for a bad one)     |
| To answer an authenticated caller without the role | 403                                                                                            |
| To log out of the app and the provider             | Clear the cookie, then redirect to `end_session_endpoint` with `post_logout_redirect_uri`      |

## Next.js 16 auth cheat sheet

| I need…                                   | Use                                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------------------- |
| Code that runs before a route renders     | `src/proxy.ts` with `export function proxy(request)` (renamed from `middleware.ts`) |
| To run it only on some paths              | `export const config = { matcher: ['/admin/:path*', '/api/admin/:path*'] }`         |
| A 403 page from the proxy                 | `NextResponse.rewrite(new URL('/forbidden', request.url), { status: 403 })`         |
| To read a cookie in a Server Component    | `(await cookies()).get('session')` (`cookies()` is async)                           |
| To set or delete a cookie                 | In a Route Handler or Server Action: `response.cookies.set(name, value, options)`   |
| To read environment variables per request | `await connection()` first, so the page is not prerendered at build time            |
| To validate the configuration at startup  | `register()` in `src/instrumentation.ts`                                            |
| A redirect after a form POST              | `NextResponse.redirect(url, 303)`                                                   |

## Data

The users (`ada`, `grace`, `alan`, `mallory`), their groups, the access review and the deployment approvals are **fictional**. No keys or tokens are stored in the repository: the tests generate their own key pairs, and the tokens for manual tries come from the mock provider.
