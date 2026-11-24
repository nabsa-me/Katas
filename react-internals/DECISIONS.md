# Decisions

## Versions

Checked on 2026-11-24.

| Package / tool                 | Version | Verified against                                                                                                     |
| ------------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------- |
| react, react-dom               | 19.3.1  | npm registry; `useEffectEvent` exported by `react` (stable since 19.2: https://react.dev/blog/2025/10/01/react-19-2) |
| vite                           | 8.3.8   | npm registry                                                                                                         |
| @vitejs/plugin-react           | 6.3.0   | npm registry (peer `vite ^8`)                                                                                        |
| vitest                         | 5.1.1   | npm registry                                                                                                         |
| jsdom                          | 28.1.0  | npm registry (`engines`: `^20.19.0 \|\| ^22.12.0 \|\| >=24.0.0`)                                                     |
| @testing-library/react         | 16.3.3  | npm registry (peer `react ^18 \|\| ^19`)                                                                             |
| @testing-library/dom           | 10.4.2  | npm registry                                                                                                         |
| @testing-library/jest-dom      | 8.0.0   | npm registry (`@testing-library/jest-dom/vitest` entry point)                                                        |
| @testing-library/user-event    | 14.6.13 | npm registry                                                                                                         |
| typescript                     | 6.0.3   | npm registry (same minor as the root tooling)                                                                        |
| @types/react, @types/react-dom | 19.3.0  | npm registry                                                                                                         |
| @types/node                    | 24.19.2 | npm registry                                                                                                         |
| eslint-plugin-react-hooks      | 7.1.1   | Root tooling; `configs.flat.recommended` from the package README                                                     |

## Decisions

- **jsdom 28, not the latest.** jsdom 30 and 31 require Node `^22.22.2 || ^24.15.0 || >=26`, which would break the repository's `>=22.12` engine range. 28.1.0 is the newest release that supports Node 22.12.
- **No `<StrictMode>` in the demo.** In development, StrictMode renders every component twice and mounts effects twice. This kata is about counting renders, so the demo mounts without it to keep the counters exact. Real applications should keep StrictMode on; the tests never use it.
- **Render counters outside React state.** `useRenderCount` and `useChangeCount` (in `src/lib`) record into a module-level log from effects and write the number straight into the DOM. Storing the count in state would cause another render, and writing a ref during render breaks the Rules of React (the `react-hooks/refs` rule reports it). An effect without dependencies does not run when `memo` skips a component, which is exactly what the counters need to show.
- **Counting function calls with `vi.mock`.** The useMemo exercise wraps the real `expensiveFilter` in `vi.fn` through `vi.mock(importOriginal)`, so the test counts the calls the components actually make.
- **Tests in `.test.tsx` as well as `.test.ts`.** Component tests need JSX. Vitest runs in `jsdom` with a setup file that registers the jest-dom matchers and calls Testing Library's `cleanup` after each test, because Vitest runs without globals and Testing Library cannot register its automatic cleanup.
- **Flawed files disable only the lint rule that catches their bug**, with a `--` justification (`react-hooks/exhaustive-deps` in the stale closure, `react-hooks/set-state-in-effect` in the derived-data snippet). Mutating state with `push` is not reported by any rule in eslint-plugin-react-hooks 7.1.1, and the README says so.
- **React 19 APIs.** Contexts use `<Context value>` as the provider and `use(Context)` to read them. `useEffectEvent` is explained in the stale closures exercise; the code uses the ref pattern because it works in every React version and shows the mechanism.
- **Hash router** copied from `svelte-maplibre` (each kata is self-contained), with the hash read through `useSyncExternalStore`. Route ids are generated from the titles.
- **Stable sample data.** Issues and table rows are module-level constants, so they keep their reference for the life of the app and never interfere with the memoization being measured.
- **Port 5802** with `strictPort`, next to `svelte-maplibre`'s 5801.

## Not verified

None.
