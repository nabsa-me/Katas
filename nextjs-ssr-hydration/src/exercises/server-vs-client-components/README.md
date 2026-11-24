# Server Components vs. Client Components

## Statement

A page lists initiatives and lets the user filter them by status. Three versions of it have problems:

1. **The whole page is a Client Component that fetches in an effect.**

   ```tsx
   'use client';
   const [initiatives, setInitiatives] = useState(null);
   useEffect(() => { fetch('/api/initiatives').then(…).then(setInitiatives) }, []);
   return initiatives ? <InitiativeFilter initiatives={initiatives} /> : <p>Loading initiatives…</p>;
   ```

   The HTML arrives with a spinner, and the data is only requested after the JavaScript has loaded and hydrated.

2. **A Server Component passes a function to a Client Component:** `<InitiativeTable formatDate={(iso) => …} />`. The route fails with `Functions cannot be passed directly to Client Components…`.
3. **A Server Component passes class instances:** `<LateInitiatives records={records.map((r) => new InitiativeRecord(r))} />`. The route fails with `Only plain objects, and a few built-ins, can be passed to Client Components from Server Components…`.

On top of that, the data module will one day hold database credentials, and nothing stops a Client Component from importing it.

Rebuild the page so the data is in the HTML, only the interactive part ships JavaScript, props cross the boundary safely, and importing the data module from client code fails the build.

## What gets assessed

- What runs where: Server Components render only on the server and never ship their code; Client Components render on the server for the HTML and again in the browser.
- Fetching in a Server Component instead of an effect: no waterfall, data in the HTML.
- The boundary: props from a Server to a Client Component are serialized, so only serializable values cross it.
- Keeping the client part small: a "client island" with only the interactive state.
- `import 'server-only'` and the export conditions that make it work.

## How to approach it, step by step

1. Ask which parts need the browser (state, event handlers, browser APIs). Here only the status filter does.
2. Make the page a Server Component that awaits the data, and move `'use client'` down to the filter.
3. Pass the filter plain data: objects with strings and numbers, ISO dates as strings. Keep functions and classes on the server (format or compute there, or define the function inside the Client Component).
4. Add `import 'server-only'` at the top of the data module.
5. Verify in the browser: view the source (the data is there), watch the network (no data request after load), and try the filter.

## Solution explained

The solution route is `src/app/(components)/server-vs-client-components/page.tsx`; the flawed ones live under the same folder (`client-fetch-problem`, `function-prop-problem`, `class-instance-problem`). The data access is [`initiatives.ts`](./initiatives.ts), the pure logic [`initiative.ts`](./initiative.ts), and the client island [`InitiativeFilter.tsx`](./InitiativeFilter.tsx).

**Two kinds of components.** In the App Router every component is a Server Component unless a module above it in the import tree says `'use client'`. Server Components run only on the server (at build time or per request): they can be `async`, read databases and secrets, and their code never reaches the browser. They produce the RSC payload, a serialized description of the UI. Client Components render on the server too (to produce HTML), and then again in the browser, where they hydrate and become interactive. `'use client'` marks the boundary: that module and everything it imports belong to the client bundle.

**Why fetching in an effect is a waterfall.** With the whole page as a Client Component, the server can only render the initial state: `Loading initiatives…`. The browser then downloads the JavaScript, hydrates, runs the effect, sends the request, waits for the response and renders again. Every step waits for the previous one, and the HTML has no content for users, crawlers or previews. In the solution the page is an `async` Server Component:

```tsx
export default async function InitiativesPage() {
  const initiatives = await getInitiatives();
  return <InitiativeFilter initiatives={initiatives} />;
}
```

The data is fetched on the server next to the data source, the HTML contains every initiative, and only `InitiativeFilter` (the buttons and their state) ships JavaScript. When there is no request-time input, `next build` even prerenders the page as static HTML (it shows as `○` in the build output); data that changes per request would make the route dynamic, or would use revalidation.

**What can cross the boundary.** Props passed from a Server Component to a Client Component are serialized into the RSC payload and rebuilt in the browser. Plain objects, arrays, strings, numbers, booleans, `null`, and a few built-ins (such as `Date`, `Map`, `Set` and promises) can travel. Functions cannot (a function is code plus a closure over server memory), except Server Functions marked with `'use server'`, which travel as references to an endpoint. Class instances cannot either: the data could be copied, but not the prototype with its methods. That is why the flawed routes fail on the server with those exact errors. The fixes: compute on the server and pass the result (a formatted string, an `isLate` boolean), define the function inside the Client Component, or use a Server Function for actions.

**`import 'server-only'`.** Bundlers resolve packages with export conditions. The Server Component graph is resolved with the `react-server` condition and the client graph without it, and the `server-only` package maps them to different files:

```json
"exports": { ".": { "react-server": "./empty.js", "default": "./index.js" } }
```

On the server the import is an empty module. In the client graph it resolves to a file that throws, and Next.js turns that into a build error. Importing [`initiatives.ts`](./initiatives.ts) from a Client Component makes `next build` (Turbopack, Next.js 16.4.6) fail with:

```
Error: You're importing a module that depends on "server-only". …
Import traces:
  Client Component Browser:
    ./src/exercises/server-vs-client-components/initiatives.ts [Client Component Browser]
    ./src/app/(components)/server-only-probe/Probe.tsx [Client Component Browser]
```

The import trace names the client file that pulled the module in. Without the guard, the module and anything it holds (a connection string, an API key read at module level) would end up in the browser bundle. `client-only` is the mirror package for browser-only modules.

**How it is proven.** [`server-vs-client-components.spec.ts`](./server-vs-client-components.spec.ts) (Playwright, development server): the flawed page's HTML has only the loading text and the browser requests `/api/initiatives` after hydrating; the solution's HTML contains every initiative, the browser makes no data request, the filter works and the console is empty; the function and class-instance routes answer 500 with the serialization errors. [`server-only.test.ts`](./server-only.test.ts) (Vitest) proves the mechanism: the package maps `react-server` to an empty module, and importing it, or `initiatives.ts`, without that condition throws. The build error itself was captured by building with a temporary Client Component that imports the data module (the excerpt above); it is not an automated test, because it would need a second, deliberately broken build of the app.

## Common mistakes

| Symptom                                                             | Cause                                                                                      |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| The HTML shows a spinner and the content pops in later              | Data fetched in a client effect; fetch in a Server Component instead.                      |
| Large client bundles for mostly static pages                        | `'use client'` too high in the tree; push it down to the interactive leaves.               |
| `Functions cannot be passed directly to Client Components`          | A callback prop from a Server Component; compute on the server or define it in the client. |
| `Only plain objects … Classes or null prototypes are not supported` | Class instances (or objects with methods) as props; pass plain data.                       |
| A secret or a database driver ends up in the browser bundle         | A server module imported from client code without `import 'server-only'`.                  |
| A Server Component "cannot use useState"                            | Hooks need a Client Component; split the interactive part out.                             |

## Practice

Add a "mark as done" button per initiative that calls a Server Function (`'use server'`) to update the data and revalidates the page, and a Playwright test that the list shows the new status without a full reload.
