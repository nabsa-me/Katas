# OIDC in Next.js

## Statement

An internal Next.js app signs users in with the company's OpenID Connect provider. Only members of the `katas-admins` group may see the access review. The current version runs the whole login in the browser, keeps the tokens in `localStorage` and decides what to show from the ID token:

```tsx
// After exchanging the code in the browser
localStorage.setItem('access_token', tokens.access_token);
localStorage.setItem('id_token', tokens.id_token);

// Rendering: the only role check decides whether the button exists
const claims = decodeJwt(idToken);
const isAdmin = Array.isArray(claims.groups) && claims.groups.includes('katas-admins');
const adminButton = isAdmin && <button onClick={loadReport}>Admin report</button>;

// The API route behind the button
export function GET() {
  return Response.json({ entries: ACCESS_REVIEW });
}
```

Symptom: `grace`, who is only in `katas-readers`, sees no button, yet `curl http://localhost:5804/api/problem/admin-report` returns the data to anyone, and `localStorage.getItem('access_token')` in the console (or in any injected script) returns her bearer token.

Rebuild it so that the browser never holds a token and the role is enforced on the server: Authorization Code flow with PKCE run by the server, a session in an `httpOnly`, `Secure`, `SameSite=Lax` cookie, a proxy protecting `/admin`, the `groups` claim mapped to roles, the role checked on the server (403 for a signed-in user without it, even when typing the URL) and a logout that also ends the provider's session.

## What gets assessed

- Choosing where the tokens live: on the server (backend for frontend) instead of in browser storage, and why `httpOnly` matters.
- The Authorization Code flow with PKCE, `state` and `nonce`: what each one protects against.
- Authorization enforced on the server, with the right status codes: redirect to log in, 401 for APIs, 403 for a missing role.
- Next.js 16 specifics: `proxy.ts` (formerly `middleware.ts`), async `cookies()`, cookies set only in Route Handlers or Server Actions.
- Proving it end to end against a real provider: a user without the group gets 403 on `/admin`.

## How to approach it, step by step

1. Start the mock provider (`docker compose up -d --wait`) and read its discovery document: `http://localhost:5806/katas/.well-known/openid-configuration`. Note the authorization, token, JWKS and end-session endpoints.
2. Validate the configuration at startup: issuer, client id, app URL and a session secret. Fail listing every problem.
3. Login route: generate the PKCE verifier, `state` and `nonce`; keep them in a short-lived, signed, `httpOnly` cookie; redirect to the authorization endpoint with the S256 challenge.
4. Callback route: check the transaction cookie, exchange the code on the server (openid-client validates `state`, the ID token signature, `iss`, `aud`, `exp` and `nonce`), map `groups` to roles and set the session cookie. Redirect to where the user was going, but only to a path on this app.
5. `proxy.ts`: no session → redirect to log in (or 401 for an API); session without the role → 403.
6. Check the role again in the protected page and API route.
7. Logout: a POST that clears the cookie and redirects (303) to the provider's end-session endpoint.
8. Write the Playwright tests that log in through the provider's form as each user.

## Solution explained

Pure logic with unit tests: [`config.ts`](./config.ts), [`session.ts`](./session.ts), [`return-to.ts`](./return-to.ts), [`guard.ts`](./guard.ts), [`admin-report.ts`](./admin-report.ts) and the shared [`rolesFromGroups`](../../lib/roles.ts). The OIDC calls are in [`oidc-flow.ts`](./oidc-flow.ts). The Next.js files are thin: [`src/proxy.ts`](../../proxy.ts), the Route Handlers under [`src/app/api/auth`](../../app/api/auth/) and [`src/app/api/admin/report`](../../app/api/admin/report/route.ts), the pages [`/admin`](../../app/admin/page.tsx) and [`/oidc-nextjs`](../../app/oidc-nextjs/page.tsx), and the startup check in [`src/instrumentation.ts`](../../instrumentation.ts). The flawed version is [`LocalStorageLogin.problem.tsx`](./LocalStorageLogin.problem.tsx) with [`admin-report.problem.ts`](./admin-report.problem.ts), shown at `/oidc-nextjs/problem`.

**Where the tokens live.** Anything in `localStorage` is readable by every script on the origin: one XSS, one compromised dependency or one browser extension is enough to copy a bearer token and use it from anywhere until it expires. In the solution the app is a confidential party in the middle (the "backend for frontend" pattern): the server exchanges the code, validates the ID token, keeps only `sub`, `name` and `roles`, and discards the provider's tokens. The browser holds a session cookie it cannot read. If the app later needs to call an API as the user, the access token stays on the server too (an encrypted cookie or a server-side session store), never in the page.

**The flow.** `GET /api/auth/login?returnTo=/admin` creates the transaction and redirects (303) to the provider:

```ts
const codeVerifier = client.randomPKCECodeVerifier();
const transaction = { codeVerifier, state: client.randomState(), nonce: client.randomNonce(), returnTo };
client.buildAuthorizationUrl(config, {
  redirect_uri,
  scope: 'openid profile',
  code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
  code_challenge_method: 'S256',
  state: transaction.state,
  nonce: transaction.nonce,
});
```

The provider shows its login form and redirects to `/api/auth/callback?code=…&state=…`. The callback opens the transaction cookie and calls `authorizationCodeGrant(config, currentUrl, { pkceCodeVerifier, expectedState, expectedNonce, idTokenExpected: true })`, then sets the session cookie and redirects to `returnTo`.

**PKCE, `state` and `nonce`.** Each binds a different piece. PKCE binds the authorization code to this login: a code intercepted on the way back is useless without the verifier, which never left the server. `state` binds the callback to this browser, so an attacker cannot make the victim complete the attacker's login (login CSRF). `nonce` binds the ID token to this request, so a token from another login cannot be replayed. The client is public (`client.None()`, no secret); with a confidential client you would add the secret and keep PKCE anyway, as RFC 9700 (OAuth 2.0 Security Best Current Practice) recommends.

**The transaction cookie.** `oidc_tx` holds the verifier, `state`, `nonce` and `returnTo` as a JWT signed with HS256, lives 10 minutes and is deleted by the callback. It is `SameSite=Lax`, not `Strict`: the redirect back from the provider is a cross-site top-level navigation, and a `Strict` cookie would not be sent with it. Session and transaction tokens carry different `typ` headers, so one can never be replayed as the other ([`session.test.ts`](./session.test.ts) checks it).

**The session cookie.** `session` is a JWT signed with HS256 (`SESSION_SECRET`), valid for 8 hours, with `httpOnly` (no script can read it), `Secure` (HTTPS only; Chromium also accepts it on `http://localhost`), `SameSite=Lax` (not sent on cross-site form posts or subrequests) and `Path=/`. It is signed, not encrypted: whoever has the cookie can read the name and roles, but changing a role breaks the signature. Do not put tokens or secrets in it.

**Groups become roles in one place.** The provider knows groups; the app knows roles. [`rolesFromGroups`](../../lib/roles.ts) maps them with an explicit table (`katas-admins → admin`, `katas-readers → reader`), ignores unknown groups and returns `[]` for anything that is not an array of strings. The claim is external data: a renamed group in the directory must not grant anything by accident.

**`proxy.ts`, formerly `middleware.ts`.** Next.js 16 renamed the file convention and the function (`export function proxy(request)`) and runs it on the Node.js runtime by default, so `jose` verifies the session there. The rename is deliberate: it is a network-boundary step in front of the app, not Express-style middleware. The matcher is `['/admin/:path*', '/api/admin/:path*']` and the decision is the pure [`decideAccess`](./guard.ts):

| Request                   | No session                            | Session without `admin` | Session with `admin` |
| ------------------------- | ------------------------------------- | ----------------------- | -------------------- |
| Page (`/admin`)           | 307 to `/api/auth/login?returnTo=...` | 403 page                | allowed              |
| API (`/api/admin/report`) | 401 JSON                              | 403 JSON                | allowed              |

APIs never redirect to a login page: a `fetch` would follow the redirect and get HTML. For the 403 page the proxy calls `NextResponse.rewrite(new URL('/forbidden', request.url), { status: 403 })`: the URL stays `/admin`, the body is the `/forbidden` page and the status is 403, verified with Next.js 16.4.6 by the Playwright test. The `forbidden()` function would do it from the page, but it still needs `experimental.authInterrupts`.

**Defense in depth.** A matcher that misses a path, a route added later or a refactor can silently drop the proxy's coverage (the Next.js docs say the same about Server Functions). So the admin API runs [`adminReportResponse`](./admin-report.ts), which answers 401/403 itself, and the `/admin` page calls `hasRole` before rendering the data. A Server Component cannot set the status code, so the page shows the forbidden message and the proxy is what returns the 403 status.

**`returnTo` cannot leave the app.** It comes from the query string. [`safeReturnTo`](./return-to.ts) accepts only paths that start with a single `/` and stay on the same origin; `https://evil.example`, `//evil.example` and `/\evil.example` fall back to `/oidc-nextjs`. Without it the login is an open redirect that ends on a phishing page right after a genuine sign-in.

**Logout.** `POST /api/auth/logout` (a form button) clears the cookie and answers 303 to the provider's end-session endpoint, built with `buildEndSessionUrl`, which adds `client_id` to the `post_logout_redirect_uri`. POST because a GET logout can be triggered by an `<img>` on any site; 303 because it turns the POST into a GET on the redirect. Ending the provider's session matters: otherwise the next "Log in" signs the user straight back in without a form. Some providers also want `id_token_hint`; this app does not keep the ID token, so it relies on `client_id`.

**Configuration fails fast.** [`parseConfig`](./config.ts) lists every missing or invalid variable at once and rejects a secret shorter than 32 characters or still equal to the `.env.example` placeholder. [`src/instrumentation.ts`](../../instrumentation.ts) runs it when the server starts and exits with code 1: without that, Next.js logs the error and keeps answering 500. `next build` does not need the secrets.

**`allowInsecureRequests`.** openid-client refuses plain http. The local mock has no TLS, so the discovery call adds `allowInsecureRequests` only when the issuer is `http:`, and `parseConfig` accepts http only for `localhost`: the opt-out cannot reach a real provider.

**The mock provider.** `ghcr.io/navikt/mock-oauth2-server` in [`docker-compose.yml`](../../../docker-compose.yml) shows a login form where any username works; its token callback gives `ada` the group `katas-admins` and `grace` the group `katas-readers`. It puts the same `aud` list (`katas-web`, `katas-api`) in the ID token and the access token, so the mapping also sets `azp: katas-web`: with several audiences, OpenID Connect requires `azp` to name the client, and openid-client rejects the ID token without it.

**How it is proven.** Vitest: [`config.test.ts`](./config.test.ts), [`session.test.ts`](./session.test.ts) (round trip, another secret, an edited payload, expiry at 8 hours, unknown roles, token-type confusion, cookie flags), [`return-to.test.ts`](./return-to.test.ts), [`guard.test.ts`](./guard.test.ts) and [`admin-report.test.ts`](./admin-report.test.ts) (the problem serves anyone; the solution answers 401, 403 and 200). Playwright, against `next build && next start` and the mock provider, in [`oidc-nextjs.spec.ts`](./oidc-nextjs.spec.ts): an anonymous visitor is sent to log in and the API answers 401; `ada` logs in through the provider's form and reaches `/admin`; `grace` gets 403 on `/admin` typing the URL and on the API; the session cookie is `httpOnly`, `Secure` and `Lax`, `document.cookie` does not show it and browser storage is empty; logout removes the cookie and the next visit to `/admin` asks for the login again; in the problem version, `grace` has no button but her token is readable from `localStorage` and the unprotected API returns the data.

## Common mistakes

| Symptom                                                           | Cause                                                                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| A reader opens the admin data with `curl`                         | The role is checked only in the UI. Hiding a button is user experience; the API must check the role itself.   |
| An XSS turns into account takeover                                | Tokens in `localStorage` or in a cookie without `httpOnly`. Keep them on the server.                          |
| The callback fails with "state mismatch" or no transaction cookie | The transaction cookie is `SameSite=Strict`, or it was set on another host (`127.0.0.1` vs `localhost`).      |
| `invalid_grant` on the token endpoint                             | The `redirect_uri` sent to the token endpoint differs from the authorize one (built from the Host header).    |
| "ID Token aud claim includes additional untrusted audiences"      | Several audiences and no `azp`: the provider issues one ID token for several clients.                         |
| After logging out, "Log in" signs straight back in                | Only the app cookie was cleared; the provider's session is still alive. Redirect to the end-session endpoint. |
| A `fetch` to a protected API gets the login page's HTML           | The proxy redirects API calls to log in. APIs answer 401.                                                     |
| A new admin route is reachable without the role                   | Only the proxy checks, and its matcher does not cover the new path. Check again in the route.                 |
| Login sends the user to an external site                          | `returnTo` used without validation: an open redirect.                                                         |
| The app starts with an empty secret and fails on the first login  | Configuration not validated at startup.                                                                       |

## Practice

Keep the access token on the server (in an encrypted cookie with `jose`'s `EncryptJWT`, or in a server-side session store keyed by the cookie) and add a page that calls the API from the "JWT validation in the API" exercise as the signed-in user, refreshing the token when it expires.
