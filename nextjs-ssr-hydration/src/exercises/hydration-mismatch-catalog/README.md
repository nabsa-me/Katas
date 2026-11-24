# Hydration mismatch catalog

## Statement

Five components work when rendered only in the browser and break once the page is server-rendered. Each one makes the first client render differ from the server HTML:

1. **Formatting a date during render:** `new Date(lastSync).toLocaleString()` in a Client Component.
2. **Random ids:** `const id = 'email-' + Math.random().toString(36).slice(2)` for a `<label htmlFor>` and its `<input id>`.
3. **Branching on `typeof window`:** `typeof window === 'undefined' ? <p>…</p> : <button>Copy link</button>`.
4. **Browser-only APIs during render:** `typeof window === 'undefined' ? null : window.innerWidth`.
5. **Invalid HTML nesting:** `<p>Open issues: <div className="card">…</div></p>`.

For each one: what breaks, why, and the fix. Every case has a `problem` and a `solution` route under `/hydration-mismatch-catalog/<case>/`.

## What gets assessed

- The rule behind all of them: the first client render must be a function of the same inputs the server had.
- Recognising the sources of difference: time and locale, randomness, environment checks, browser APIs, and the HTML parser itself.
- The tools: deterministic formatting, `useId`, `useSyncExternalStore` with `getServerSnapshot`, `dynamic(…, { ssr: false })`, valid markup.
- The cost of each fix (an extra render, a placeholder in the HTML, content missing from the HTML).
- Reproducing them with a browser in another time zone and locale than the server.

## How to approach it, step by step

1. Run the server and the browser with different settings (here the server runs with `TZ=UTC` and the browser in `Pacific/Auckland` with `ja-JP`); many of these bugs never show on a developer machine.
2. Open each problem route with the console open and read the message: text, element or attribute mismatch, or invalid nesting.
3. For each component, list what its first render depends on and ask whether the server had the same value.
4. Make the value identical on both sides (format deterministically, `useId`), or render the same placeholder on both sides and read the browser value right after hydration (`useSyncExternalStore`), or skip server rendering for that piece (`ssr: false`).
5. Check the solution route: an empty console, and the HTML still contains everything it can.

## Solution explained

Every case lives in this folder as `<Component>.problem.tsx` and `<Component>.tsx`; [`cases.ts`](./cases.ts) lists them and [`catalog.tsx`](./catalog.tsx) maps each case to its components for the dynamic route `src/app/(catalog)/hydration-mismatch-catalog/[slug]/[variant]/page.tsx` (prerendered for every case and variant with `generateStaticParams`; other URLs are a 404 thanks to `dynamicParams = false`).

**The rule.** During hydration React renders the tree again in the browser and compares it with the DOM built from the server HTML. Text or element differences are recoverable errors (`Hydration failed because the server rendered text|HTML didn't match the client`): React discards that part of the server HTML up to the nearest Suspense or error boundary and renders it again on the client, which costs time and can flash. Attribute differences are reported only in development, and the DOM keeps the server's values. So the first client render must depend only on what the server also had.

**Formatting a date during render** ([`LastSync.problem.tsx`](./LastSync.problem.tsx) → [`LastSync.tsx`](./LastSync.tsx)). `toLocaleString()` uses the time zone and locale of the machine running it: the server (UTC, its own locale) and the user's browser produce different text. The fix formats with an explicit locale and time zone through `Intl.DateTimeFormat('en-GB', { …, timeZone: 'UTC' })` in [`format.ts`](./format.ts), so the output depends only on the timestamp, and wraps it in `<time dateTime>`. When the product must show the user's local time instead, Next.js documents a variant: the server renders a default, an inline script right after the element rewrites the text before the first paint, and `suppressHydrationWarning` on that `<time>` accepts the DOM's text (see "Dates and formatting" in the [Next.js guide on preventing flash before hydration](https://nextjs.org/docs/app/guides/preventing-flash-before-hydration)).

**Random ids** ([`EmailField.problem.tsx`](./EmailField.problem.tsx) → [`EmailField.tsx`](./EmailField.tsx)). `Math.random()` gives a different id on each side, so `for` and `id` differ (an attribute mismatch, reported only in development). `useId()` derives the id from the component's position in the tree, which is identical on the server and in the browser. The React lint rule `react-hooks/purity` reports `Math.random()` during render; the flawed file disables it with a justification.

**Branching on `typeof window`** ([`ShareButton.problem.tsx`](./ShareButton.problem.tsx) → [`ShareButton.tsx`](./ShareButton.tsx)). The check is a correct way to know where code runs, but as a render branch it guarantees different output: the server renders the paragraph, the browser's first render the button. The fix renders the server's branch during hydration too and switches right after, with [`useIsClient`](./useIsClient.ts):

```ts
useSyncExternalStore(
  subscribe,
  () => true,
  () => false,
);
```

React uses the server snapshot (`false`) while hydrating, so the first client render matches the HTML, and re-renders immediately with the client snapshot (`true`).

**Browser-only APIs during render** ([`ViewportWidth.problem.tsx`](./ViewportWidth.problem.tsx) → [`ViewportWidth.tsx`](./ViewportWidth.tsx), [`ViewportWidthWithoutSsr.tsx`](./ViewportWidthWithoutSsr.tsx)). The server has no `window`; reading it on the first client render produces different text. Three tools, with different costs:

- **`useSyncExternalStore` with `getServerSnapshot`** (used here): the window is an external store with `resize` as its subscription, and `null` as the server snapshot. The HTML contains the component with a placeholder ("unknown"), hydration matches, the real value arrives one render later, and it stays updated. Cost: one extra render and a placeholder; it is the idiomatic React way.
- **`dynamic(() => import('./ViewportWidthLive'), { ssr: false })`** (used here): the component is left out of the server render; the HTML only has the `loading` fallback, and the browser downloads and renders the real component after hydration. Cost: that content is missing from the HTML (no SEO, a layout shift when it appears) and it needs one more request for its chunk. It is only allowed in a Client Component.
- **The "mounted" pattern**: `const [mounted, setMounted] = useState(false); useEffect(() => setMounted(true), [])`, rendering the browser value only when `mounted`. It works, but costs a full extra render of the component after every mount, and the `react-hooks/set-state-in-effect` lint rule reports it; `useSyncExternalStore` does the same job without state copied from an effect.

**Invalid HTML nesting** ([`IssueSummary.problem.tsx`](./IssueSummary.problem.tsx) → [`IssueSummary.tsx`](./IssueSummary.tsx)). A `<div>` inside a `<p>` is invalid HTML; the browser's parser closes the `<p>` as soon as it meets the `<div>`, so the DOM is not the tree React rendered. It breaks hydration even in a Server Component, which shows that the comparison is against the parsed DOM, not against the HTML string. React reports `In HTML, <div> cannot be a descendant of <p>` in development. The fix is valid markup: a block wrapper around the paragraph and the card.

**What `suppressHydrationWarning` is not.** It is tempting to silence any of these with `suppressHydrationWarning`. It only applies to one element's own attributes and text, React keeps the server's value instead of fixing it, and it does nothing for element differences. It is reserved for a deliberate, known difference, such as the theme class set by an inline script on `<html>` (see [Light/dark theme without flash](../theme-without-flash/README.md)).

**How it is proven.** [`hydration-mismatch-catalog.spec.ts`](./hydration-mismatch-catalog.spec.ts) runs Chromium in `Pacific/Auckland` with the `ja-JP` locale against the development server (started with `TZ=UTC`). For every case, the problem route produces a hydration report in the console and the solution route hydrates with an empty console. It also checks what the solutions show: the date text is the same in the raw HTML and after hydration, the label reaches its input, the "Copy link" button appears after hydration while the HTML has the placeholder, and the viewport width is read in the browser (`useSyncExternalStore` follows a resize; the `ssr: false` component is absent from the HTML). [`catalog.test.ts`](./catalog.test.ts) covers the registry and the deterministic formatter.

## Common mistakes

| Symptom                                                    | Cause                                                                                     |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Hydration errors only in production or for some users      | Time zone or locale differences: the developer's machine matches the browser.             |
| `A tree hydrated but some attributes …` with ids           | `Math.random()`, `Date.now()` or a counter generating ids; use `useId`.                   |
| `Hydration failed because the server rendered HTML …`      | A branch on `typeof window`, `localStorage` or a media query in the first render.         |
| Content flashes when the page loads                        | React re-rendered a whole subtree after a mismatch, or the value is applied in an effect. |
| A section is missing from the HTML and pops in later       | `ssr: false` used where a placeholder plus `useSyncExternalStore` would do.               |
| `In HTML, <div> cannot be a descendant of <p>`             | Invalid nesting, often hidden inside a component rendered within a `<p>`.                 |
| `suppressHydrationWarning` added and the UI is still wrong | It hides the report; React does not patch the DOM.                                        |

## Practice

Add a sixth case: a component that renders `navigator.onLine` during the first render. Write the flawed version and a fix with `useSyncExternalStore` subscribed to the `online` and `offline` events, and add it to the browser tests.
