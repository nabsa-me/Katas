# Light/dark theme without flash or hydration mismatch

## Statement

The app has a light and a dark theme. The first implementation keeps the user's choice in `localStorage` and reads it in a Client Component:

```tsx
'use client';
const [theme, setTheme] = useState(() =>
  typeof window === 'undefined' ? 'light' : (localStorage.getItem('theme') ?? 'light'),
);
return <div className={`theme-root ${theme}`}>{children}</div>;
```

Symptoms for a user who chose dark:

- On every load the page appears light first: a flash of the wrong theme.
- The console says `A tree hydrated but some attributes of the server rendered HTML didn't match the client properties. This won't be patched up.` The page stays light, the toggle claims dark is on, and the first click on it seems to do nothing.
- Moving the read into a `useEffect` removes the warning, but not the flash.

Build two solutions: one for an **explicit choice**, rendered by the server from a cookie; and one that also supports **"follow the system"** when the user has not chosen, without making every page dynamic.

## What gets assessed

- Explaining the whole cycle: server HTML → first paint → JavaScript → hydration → comparison, and why the first client render must produce exactly what the server produced.
- Knowing what the server can read (cookies, headers) and what only the browser knows (`localStorage`, media queries, time zone).
- A cookie read in the root layout with `cookies()`, and a Server Action to change it.
- A blocking inline script in `<head>`, and `suppressHydrationWarning` on `<html>` only, with the reasons.
- Proving "no flash" and "no mismatch" with browser tests, not by eye.

## How to approach it, step by step

1. Reproduce: store `theme=dark`, reload with the CPU and network throttled in DevTools, and read the console.
2. Draw the timeline of a page load and mark, for each approach, the moment the theme becomes known. Anything known after the first paint flashes.
3. Pick a source of truth the server can read: a cookie travels with every request; `localStorage` never leaves the browser.
4. Explicit choice: read the cookie in the root layout, render `<html className={theme}>`, and change it with a Server Action that sets the cookie.
5. System preference: the server cannot know it, so fix the DOM before the first paint with an inline script in `<head>`; add `suppressHydrationWarning` to `<html>`; read the preference in the switcher with `useSyncExternalStore`.
6. Write browser tests for the raw HTML, the console, and the first paint.

## Solution explained

Files in this folder: the flawed versions [`StoredThemeInRender.problem.tsx`](./StoredThemeInRender.problem.tsx) and [`StoredThemeInEffect.problem.tsx`](./StoredThemeInEffect.problem.tsx); the cookie solution [`actions.ts`](./actions.ts) and [`CookieThemeForm.tsx`](./CookieThemeForm.tsx); the script solution [`theme-script.ts`](./theme-script.ts) and [`SystemThemeSwitcher.tsx`](./SystemThemeSwitcher.tsx); the shared pure logic [`theme.ts`](./theme.ts). The root layouts live in `src/app/(theme-problem)`, `src/app/(theme-cookie)` and `src/app/(theme-system)`: each variant needs its own `<html>`, so each route group has its own root layout.

**The cycle, step by step.**

1. **Request.** The browser sends the URL, the cookies and headers (`Accept-Language`, …). It does not send `localStorage`, the result of media queries, the window size or the time zone.
2. **Server render.** React renders the Server Components and the Client Components to HTML (Client Components also run on the server, without `window`), and the server streams it.
3. **Parse and first paint.** The browser parses the HTML, runs inline `<script>` tags synchronously as it meets them, waits for the CSS and paints. **Whatever the HTML says at this moment is what the user sees.** No React code has run yet.
4. **JavaScript.** The bundles download and execute. On a slow phone or network this takes seconds, and the server HTML stays on screen meanwhile.
5. **Hydration.** React renders the same tree again in the browser and walks the existing DOM, adopting the nodes and attaching event handlers instead of creating them. While doing so it checks that what it rendered matches what is there.
6. **Mismatches.** A different text or element is a recoverable error (`Hydration failed because the server rendered text didn't match the client`): React throws away the server HTML up to the nearest Suspense or error boundary and renders it again on the client (a flash, and more work). A different **attribute** is only reported in development (`… This won't be patched up.`), and React keeps the server's value in the DOM while its own state says otherwise. Production builds do not report attribute mismatches at all.
7. **Effects.** `useLayoutEffect` runs after hydration but before the next paint; `useEffect` after the paint.

**Why server and client must produce the same initial HTML.** Hydration only works because React assumes the DOM is exactly what it would have rendered: that is what lets it reuse the server's nodes instead of building new ones. So the first client render must depend only on data both sides had (props and the RSC payload). Reading browser-only state during that render breaks the assumption. There are three honest ways out: let the server know the value (a cookie), read it after hydration (and accept the flash), or correct the DOM before React looks at it and tell React the difference is expected.

**Why the flawed versions fail.** In `StoredThemeInRender`, the server renders `light` and the browser's first render reads `dark`: an attribute mismatch, so the DOM keeps `light` while the state says `dark`. The toggle's `aria-pressed` stays as the server rendered it too, and the first click moves the state from `dark` to `light`, which changes nothing on screen. In `StoredThemeInEffect` there is no mismatch (the first render matches the server), but the effect runs after the light HTML has been painted: the flash lasts as long as the JavaScript takes to arrive.

**Solution 1: an explicit choice in a cookie, rendered by the server.**

```tsx
// src/app/(theme-cookie)/layout.tsx
export default async function CookieThemeLayout({ children }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value) ?? 'light';
  return (
    <html lang="en" className={theme}>
      …
    </html>
  );
}
```

The cookie comes with the request, so the HTML is already themed at the first paint, and the client renders the same class from the same RSC payload: nothing to flash, nothing to mismatch. The switch is a `<form action={setThemeAction}>` whose buttons post `theme=dark` or `theme=light`. Cookies can only be set in a Server Action or a Route Handler (a Server Component's response is already streaming when it runs). After the action, Next.js re-renders the route, root layout included, and sends the new UI in the same round trip, so `<html>` changes class without a reload; the form even works before the JavaScript loads. The value is validated on both ends (`parseTheme`), because cookies and form posts are external input. The trade-off: calling `cookies()` in a root layout makes every route under it dynamic, rendered per request instead of prerendered and cached.

**Solution 2: the system preference with a blocking inline script.** When the user has not chosen, the right theme depends on `prefers-color-scheme`, which the server never sees. The fix is to correct the DOM during parsing, before the first paint:

```tsx
// src/app/(theme-system)/layout.tsx
<html lang="en" suppressHydrationWarning>
  <head>
    <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
  </head>
```

The [script](./theme-script.ts) reads the `theme` cookie and falls back to `matchMedia('(prefers-color-scheme: dark)')`, then sets the class and `color-scheme` on `<html>`. It is plain ES5 inside a `try`/`catch`, because it runs before any bundle and must never break the page. The layout reads no request data, so the route stays static. The switcher writes the cookie with `document.cookie` (so the next load's script and any server code see the same choice) and re-applies the class.

**`suppressHydrationWarning`, only on `<html>`.** After the script runs, `<html>` has a class React did not render, and React would report the difference while hydrating. `suppressHydrationWarning` tells React that the attributes of this one element are expected to differ, and that it should keep what the DOM has. It is justified here because the difference is deliberate, is produced by our own code before hydration, and is on an element whose class React does not otherwise manage. It only applies to that element's own attributes and text, one level deep: everything inside `<body>` is still checked. Anywhere else it hides real bugs: React would keep a stale DOM silently, exactly the broken state of the flawed version, just without the warning.

**Two details of the switcher.** It reads the preference with `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)`; `getServerSnapshot` returns `null`, which React uses on the server and during hydration, so the first client render matches the server (no button pressed) and React re-renders with the real value right after. And in development only, Strict Mode remounts the tree once and resets the attributes of `<html>` to the ones JSX manages, removing the class the script set; the switcher re-applies it in a `useLayoutEffect`, before the browser paints (in production that effect only confirms what the script did).

| Approach                          | First paint             | Hydration                        | Rendering of the route |
| --------------------------------- | ----------------------- | -------------------------------- | ---------------------- |
| `localStorage` read during render | Wrong theme             | Mismatch, not patched            | Static                 |
| `localStorage` read in an effect  | Wrong theme, then fixed | Clean                            | Static                 |
| Cookie read in the root layout    | Right theme             | Clean                            | Dynamic (per request)  |
| Inline script + cookie or system  | Right theme             | Clean (`<html>` only suppressed) | Static                 |

Inline scripts need a nonce or a hash under a strict Content Security Policy. A Chromium-only alternative for the system preference is the `Sec-CH-Prefers-Color-Scheme` client hint, which the server must request with `Accept-CH` and therefore misses on the very first request.

**How it is proven.** [`theme.test.ts`](./theme.test.ts) covers parsing, cookie strings and resolution; [`theme-script.test.ts`](./theme-script.test.ts) runs the real script string against a fake `document` and `window`. [`theme-without-flash.spec.ts`](./theme-without-flash.spec.ts) drives Chromium against the development server, because attribute mismatches are only reported in development builds:

- the raw HTML requested with `Cookie: theme=dark` already contains `<html … class="dark">`;
- both solutions hydrate with an empty console (no errors, no warnings), while the flawed render variant reports the attribute mismatch and keeps the light class;
- with every `/_next/static/**/*.js` request aborted, React never runs and the page stays as first painted: the effect variant is light, the cookie and script variants are dark, and the script honours a stored choice over the system preference (`page.emulateMedia({ colorScheme: 'dark' })`);
- the Server Action sets the cookie and the choice survives a reload.

## Common mistakes

| Symptom                                                     | Cause                                                                                        |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| The light theme flashes on every load                       | The theme is applied by React (an effect, or after hydration) instead of being in the HTML.  |
| `A tree hydrated but some attributes … won't be patched up` | `localStorage`, `window` or `matchMedia` read during the first render of a Client Component. |
| `suppressHydrationWarning` on a `div` "fixed" the warning   | It hid it: React keeps the stale DOM and the UI stays inconsistent.                          |
| The theme is right on load but disappears in development    | Strict Mode's remount resets `<html>` attributes; re-apply in a `useLayoutEffect`.           |
| Setting the cookie throws in a page or layout               | Cookies can only be set in a Server Action or a Route Handler.                               |
| Every page became dynamic after adding the theme            | `cookies()` in the root layout; the inline script keeps routes static.                       |
| The inline script does not run in production                | A Content Security Policy without a nonce or hash for it.                                    |
| A storage or cookie error breaks the whole page             | The inline script has no `try`/`catch`.                                                      |

## Practice

Make the theme follow a change made in another tab: notify the switcher's external store from a `BroadcastChannel`, and add a Playwright test that opens two pages in the same context.
