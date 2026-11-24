# nextjs-ssr-hydration

Three katas on server rendering and hydration with the Next.js App Router, solved and explained: a light/dark theme without flash or hydration mismatch, a catalog of the usual mismatches, and the split between Server and Client Components. Every exercise has routes for the flawed versions and for the solutions, and browser tests that prove the difference.

## Run

Requires Node 22.12 or later.

```bash
cd nextjs-ssr-hydration
npm install
npm run dev                       # http://localhost:5803
npm test                          # unit tests for the pure logic (Vitest)
npx playwright install chromium   # once, for the browser tests
npm run e2e                       # browser tests (Playwright); starts the dev server
npm run check                     # route types and type checking
npm run build                     # optional: production build, shows which routes are static or dynamic
```

The home page links every route. Keep the browser console open: it is where React reports hydration problems. The statement, the explained solution and the common mistakes are in the `README.md` of each exercise folder.

## How to use these katas

1. Read the exercise statement (only the "Statement" section).
2. Try to solve it **yourself, in an empty project, without an assistant**. Official documentation only.
3. If you get stuck, read "How to approach it, step by step" and carry on.
4. When done, compare with the solution and read "Solution explained" and "Common mistakes".
5. Repeat the exercise another day without looking.

| Exercise                                                                                            | What it practises                                                                               |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [Light/dark theme without flash or hydration mismatch](src/exercises/theme-without-flash/README.md) | The SSR cycle, `cookies()`, Server Actions, blocking inline scripts, `suppressHydrationWarning` |
| [Hydration mismatch catalog](src/exercises/hydration-mismatch-catalog/README.md)                    | Dates and locales, `useId`, `useSyncExternalStore`, `ssr: false`, valid HTML                    |
| [Server Components vs. Client Components](src/exercises/server-vs-client-components/README.md)      | Server fetching, client islands, serializable props, `server-only`                              |

## Where a value is known

| Value                               | During the server render    | Before React runs (inline script) | After hydration          |
| ----------------------------------- | --------------------------- | --------------------------------- | ------------------------ |
| Cookies, request headers            | Yes                         | Cookies not marked `httpOnly`     | Yes                      |
| `localStorage`, `sessionStorage`    | No                          | Yes                               | Yes                      |
| `prefers-color-scheme`, window size | No                          | Yes                               | Yes                      |
| The user's time zone and locale     | No (only `Accept-Language`) | Yes                               | Yes                      |
| Data from the database              | Yes                         | No                                | Through props or a fetch |

Anything the server cannot know must not change the first client render: put it in a cookie, apply it before the paint with an inline script, or read it after hydration.

## Hydration cheat sheet

| I need…                                          | Use                                                                           |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| A value from the request in a Server Component   | `await cookies()`, `await headers()` (makes the route dynamic)                |
| To set a cookie                                  | A Server Action or a Route Handler, never a Server Component                  |
| The same id on the server and in the browser     | `useId()`                                                                     |
| A browser value without a mismatch               | `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)`             |
| To render something only in the browser          | `dynamic(() => import('./X'), { ssr: false })` in a Client Component          |
| To fix the DOM before the first paint            | An inline `<script>` in `<head>` of the root layout                           |
| To accept a deliberate difference on one element | `suppressHydrationWarning` on that element only (e.g. `<html>` for the theme) |
| Dates that read the same everywhere              | `Intl.DateTimeFormat` with an explicit locale and `timeZone`                  |
| Data in the initial HTML                         | Fetch in an `async` Server Component                                          |
| Interactivity on part of a server-rendered page  | A small Client Component (`'use client'`) that receives plain props           |
| A module that must never reach the browser       | `import 'server-only'`                                                        |
| Different `<html>` per section                   | Route groups, each with its own root layout                                   |

Reproduce locale and time zone bugs by running the server with a different time zone than the browser (the browser tests run the server with `TZ=UTC` and Chromium in `Pacific/Auckland` with `ja-JP`).

## Data

`src/data/initiatives.json` holds six **fictional** initiatives (names, teams and dates are made up).
