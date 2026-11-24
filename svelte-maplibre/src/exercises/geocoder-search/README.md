# ICGC geocoder search

## Statement

A search field that suggests places while typing, using the ICGC geocoder autocomplete. Arrow keys move through the suggestions, Enter or a click picks one, and the map flies to the chosen place and drops a marker.

## What gets assessed

This is the most "plain JavaScript" exercise of the series. Reviewers mainly look at:

- **Debounce**: not firing a request on every keystroke.
- **Race conditions**: if you type "gir" and then "giro", the "gir" response may arrive later. It must not be rendered.
- **Network errors**, handled and visible.
- **Accessibility** of a combobox: keyboard and ARIA.
- Validating data that comes from outside.

## How to approach it, step by step

1. Try the API in the browser first: `https://eines.icgc.cat/geocodificador/autocompletar?text=cambrils&size=2`. Look at the response shape (a `FeatureCollection` with `nom`, `etiqueta`, `municipi` and the kind in `addendum.tipus`; those field names belong to the service, in Catalan).
2. Write the function that turns the response into a simple list. Test it with a sample of the real response.
3. Input with `bind:value` and an `oninput` that, from 3 characters on, calls the search with a 300 ms debounce.
4. In the search: abort the previous request with `AbortController`, run `fetch`, check `response.ok`, transform and store.
5. Keyboard: arrows to move, Enter to pick, Escape to close.
6. On pick: `flyTo` and `Marker`.

## Solution explained

**Pure logic in [`search.ts`](./search.ts)**, tested in [`search.test.ts`](./search.test.ts):

- `parseResults` validates each feature: anything without a point made of two numbers is dropped. An external response is never trusted.
- `nextActiveIndex` moves the selection and wraps around at both ends.
- `debounce` returns `call` and `cancel`. The test uses fake timers (`vi.useFakeTimers`) to check it is called once, with the last text.

**Debounce + AbortController.** Two different problems, solved separately:

- Debounce reduces the number of requests (one goes out when the user stops typing for 300 ms).
- `AbortController` solves the race: before each request, the previous one is aborted. The aborted request throws an `AbortError`, which is ignored on purpose; any other error is shown to the user.

**Events, not effects.** The search starts from `oninput`, not from a `$effect` watching `query`. A useful Svelte 5 rule: if something happens because the user did something, it goes in the event handler; `$effect` is for syncing with the outside world (the map, the DOM, timers).

**Accessible combobox:**

- The input has `role="combobox"`, `aria-expanded`, `aria-controls` and `aria-activedescendant`, which points to the active option.
- The list has `role="listbox"` and each item `role="option"` with `aria-selected`.
- Focus never leaves the input; the keyboard is handled there. That is why the options' `onclick` has no keyboard handler of its own, as the comment that silences the Svelte warning explains.
- `onmousedown` with `preventDefault` on the list: without it, the input loses focus before the click arrives.

**Cleanup.** The `$effect` that only returns a function runs on unmount: it cancels the timer, aborts the request and removes the marker.

**CORS.** The browser only lets you read the response if the server allows your origin (CORS headers). The ICGC geocoder is meant to be used from web apps; if it ever blocked you, the fix is not to disable anything in the browser but to route the request through your own backend.

## Common mistakes

| Symptom                                | Cause                                                               |
| -------------------------------------- | ------------------------------------------------------------------- |
| One request per keystroke              | No debounce.                                                        |
| Results from a previous search show up | No `AbortController` (or no check that the response is the latest). |
| The list closes before you can click   | The input loses focus on `mousedown`.                               |
| `AbortError` in the console            | Cancellation not told apart from a real error.                      |
| The map flies into the sea             | `[lat, lon]` passed to `flyTo`.                                     |

## Practice

Add an in-memory cache (`Map<string, SearchResult[]>`) so searches already made are not repeated, and a test that proves it.
