# react-internals

Five katas on how React decides what to render again, solved and explained: referential equality, memoization, context and closures. Each exercise shows the flawed version next to the fixed one, with counters for renders and recomputations, and tests that prove the difference.

## Run

Requires Node 22.12 or later.

```bash
cd react-internals
npm install
npm run dev      # http://localhost:5802
npm test         # component and logic tests (Vitest, Testing Library, jsdom)
npm run check    # type checking
```

The left menu opens each exercise. The statement, the explained solution and the common mistakes are in the `README.md` of each folder.

## How to use these katas

1. Read the exercise statement (only the "Statement" section).
2. Try to solve it **yourself, in an empty project, without an assistant**. Official documentation only.
3. If you get stuck, read "How to approach it, step by step" and carry on.
4. When done, compare with the solution and read "Solution explained" and "Common mistakes".
5. Repeat the exercise another day without looking.

| Exercise                                                                                  | What it practises                                                       |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [useMemo with an inline object dependency](src/exercises/usememo-inline-object/README.md) | `Object.is`, dependency arrays, primitive dependencies, stable objects  |
| [React.memo defeated by inline props](src/exercises/react-memo-inline-props/README.md)    | `memo`, hoisted constants, `useCallback`, composition with `children`   |
| [Inline value in a Context Provider](src/exercises/context-provider-value/README.md)      | Context updates, memoized value, separate state and actions contexts    |
| [Stale closures](src/exercises/stale-closures/README.md)                                  | Closures per render, functional updates, refs, `useEffectEvent`, timers |
| [Code review: common React bugs](src/exercises/react-code-review-snippets/README.md)      | Keys, derived state, effects for derived data, fetch races, mutation    |

## What creates a new reference on every render

| Written in a component body          | New reference every render?                        | Stable alternative                                             |
| ------------------------------------ | -------------------------------------------------- | -------------------------------------------------------------- |
| `'done'`, `42`, `true`               | No (compared by value)                             | —                                                              |
| `{ status, query }`                  | Yes                                                | Module constant, or `useMemo(() => ({ … }), [deps])`           |
| `['key', 'title']`                   | Yes                                                | Module constant, or `useMemo`                                  |
| `() => select(id)`                   | Yes                                                | `useCallback`, or one handler that receives the id             |
| `items.filter(…)`, `items.map(…)`    | Yes                                                | `useMemo`, or compute where it is used                         |
| `<Child />` (JSX)                    | Yes                                                | Receive it as `children` from a parent that does not re-render |
| `useState` value, setter, `dispatch` | No (until the state changes; setters never change) | —                                                              |
| `useRef(…)` object                   | No                                                 | —                                                              |

## React rendering cheat sheet

| I need…                                                 | Use                                                                  |
| ------------------------------------------------------- | -------------------------------------------------------------------- |
| To know why something rendered                          | React DevTools Profiler ("Why did this render?") or a render counter |
| To skip an expensive computation                        | `useMemo(() => compute(a, b), [a, b])`, after measuring              |
| To skip rendering a child with the same props           | `memo(Child)` plus stable props                                      |
| A function prop that keeps its identity                 | `useCallback(fn, [deps])`, or define it outside the component        |
| The next state from the current one                     | `setX((current) => next)`                                            |
| A value that survives renders without causing them      | `useRef`, written in effects and handlers, never during render       |
| The latest props inside an effect without restarting it | `useEffectEvent` (React 19.2+) or a ref updated in an effect         |
| A value computed from props or state                    | Compute it during render; no state, no effect                        |
| To reset a component's state when its subject changes   | A different `key`                                                    |
| Context that does not re-render every consumer          | A memoized `value`, and state and actions in separate contexts       |
| To ignore a stale response in an effect                 | `AbortController` in the cleanup, and check `signal.aborted`         |
| External state (URL, storage, a store)                  | `useSyncExternalStore(subscribe, getSnapshot)`                       |

Rule of thumb: measure before memoizing, and prefer composition (`children`, moving state down) to `memo`.

## Data

`src/data/issues.json` holds 24 **fictional** issues (keys, titles and assignees are made up).
