# Decisions

## Versions

Checked on 2026-11-24.

| Package / tool                 | Version | Verified against                                                                                            |
| ------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------- |
| next                           | 16.4.6  | npm registry; documentation bundled in `node_modules/next/dist/docs/` (guides and API reference used below) |
| react, react-dom               | 19.3.1  | npm registry; hydration messages read in `react-dom` 19.3.1 development build                               |
| server-only                    | 0.0.1   | Package `exports` (`react-server` → `empty.js`, `default` → `index.js`)                                     |
| @playwright/test               | 1.65.1  | npm registry; `emulateMedia`, `route().abort()`, `request.get`, context `timezoneId`/`locale`               |
| vitest                         | 5.1.1   | npm registry                                                                                                |
| typescript                     | 6.0.3   | npm registry (same minor as the root tooling)                                                               |
| @types/react, @types/react-dom | 19.3.0  | npm registry                                                                                                |
| @types/node                    | 24.19.2 | npm registry                                                                                                |

Next.js guides relied on: "How to prevent flash before hydration" (inline scripts, `suppressHydrationWarning`, the cookie variant, the development Strict Mode remount), `cookies` (async, set only in Server Functions or Route Handlers, makes the route dynamic), `route-groups` (multiple root layouts), `lazy-loading` (`ssr: false` only in Client Components), `typescript` (`tsconfigPath`), `agentRules`.

## Decisions

- **A root layout per route group, no top-level layout.** The theme variants each need their own `<html>` (plain, with a server-read class, or with an inline script and `suppressHydrationWarning`). Moving between root layouts is a full page load, so the home page uses plain links.
- **Browser tests against the development server.** React reports attribute mismatches only in development builds, and those reports are part of what the tests prove. The production build was checked separately with `npm run build`: it succeeds and its route table matches the READMEs (`/theme-without-flash/cookie` dynamic, `/theme-without-flash/system` static, the solution page of the components exercise prerendered).
- **Different time zone and locale on each side.** The dev server started by Playwright runs with `TZ=UTC`; Chromium runs in `Pacific/Auckland` with `ja-JP`, so locale bugs reproduce deterministically.
- **First paint measured with the bundles blocked.** Aborting every `/_next/static/**/*.js` request leaves the page exactly as the browser painted it from the HTML and inline scripts, which is what the user sees until hydration.
- **`HydrationMarker`** (a Client Component that sets `data-hydrated` on `<body>` in an effect) lets the tests wait for hydration, and for any report it produces, before asserting.
- **Theme class on `<html>`**, `dark` toggles the CSS variables. The theme cookie is not `httpOnly` (it is not sensitive and the inline script must read it), `SameSite=Lax`, `Secure` in production, one year; values are validated on every read and write.
- **Raw `<script dangerouslySetInnerHTML>` in `<head>`**, as in the Next.js guide. React's development warning about `<script>` tags did not appear: the browser tests assert a completely empty console on that route. The switcher re-applies the class in a `useLayoutEffect` because the development-only Strict Mode remount resets the attributes of `<html>`.
- **`next.config.ts`:** `typescript.tsconfigPath` points at `tsconfig.app.json` to keep the TypeScript split of the other katas (Next.js added `allowJs` and `esModuleInterop` to it on first run); `turbopack.root` because the repository root has its own lockfile; `agentRules: false` so `next dev` does not write an `AGENTS.md` into the kata.
- **`npm run check` runs `next typegen` first.** It generates `next-env.d.ts` (gitignored, as the Next.js docs recommend) and the route types such as `PageProps<'/…'>`.
- **Routes that demonstrate a server error are `force-dynamic`**, so `next build` does not try to prerender them.
- **The `server-only` build error is documented, not automated.** It was captured by building once with a temporary Client Component that imports the data module (Turbopack's message and import trace are quoted in the exercise README). Automating it would need a second, deliberately broken build; the Vitest test covers the export-condition mechanism instead.
- **Playwright specs (`*.spec.ts`) live next to the exercise**, Vitest only picks `*.test.ts`. The specs import JSON with `with { type: 'json' }`, which Node's ESM loader requires. Playwright runs one worker, because the development server compiles each route on its first request.

## Not verified

- ⚠️ The `Sec-CH-Prefers-Color-Scheme` client hint, mentioned in the theme exercise as an alternative, is not used or tested here. Reference: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-CH-Prefers-Color-Scheme
