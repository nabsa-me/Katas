# useMemo with an inline object dependency

## Statement

An issue board has a status select and a search box. The parent keeps both values in state, builds a `filters` object and passes it to a child that filters a long list. The filter is expensive, so the child memoizes it:

```tsx
// Parent
const filters = { status, query };
return <FilteredList items={issues} filters={filters} />;

// Child
const visible = useMemo(() => expensiveFilter(items, filters), [items, filters]);
```

Symptom: any state change in the parent, even one that has nothing to do with the filter, runs `expensiveFilter` again. The `useMemo` is there, but it never returns the cached value. Fix it so the filter only runs when the items, the status or the text change.

## What gets assessed

- How React compares dependencies: `Object.is`, one by one, against the previous render.
- Seeing that an object or array literal in a component body is a **new reference on every render**.
- The two fixes and where each one belongs: primitive dependencies in the child, a memoized object in the parent.
- Proving it with a test that counts calls, not by eye.
- Knowing when `useMemo` is not worth it.

## How to approach it, step by step

1. Reproduce: count the calls (a `console.count` inside the memoized function, or a spy in a test) and trigger a render that changes nothing the filter uses. If the count goes up, the cache is missed.
2. Go through the dependency array asking, for each item, "is this the same reference as in the previous render?" Strings, numbers and booleans compare by value; objects, arrays and functions by reference.
3. Find where `filters` is created: in the parent's body, as a literal. Every render runs that line again.
4. Fix the child: destructure `status` and `query` and use them as dependencies.
5. Fix the parent: wrap the object in `useMemo` with `[status, query]`.
6. Write the test: count the calls to `expensiveFilter` after N unrelated renders.

## Solution explained

[`filter.ts`](./filter.ts) holds the pure filter, tested in [`filter.test.ts`](./filter.test.ts). [`FilteredList.problem.tsx`](./FilteredList.problem.tsx) is the flawed version, [`FilteredList.tsx`](./FilteredList.tsx) the fixed one, and [`FilteredList.test.tsx`](./FilteredList.test.tsx) proves the difference.

**How `useMemo` decides.** On every render, React walks the dependency array and compares each item with the one from the previous render using `Object.is`. If all of them are equal, it returns the cached value; if any differs, it calls the function again and caches the new result. There is no deeper comparison: React never looks inside an object.

**Why `{} !== {}`.** An object literal creates a new object every time the line runs. Two objects with the same content are still two different objects in memory, and `Object.is` compares identity:

```ts
Object.is('done', 'done'); // true: primitives compare by value
Object.is({ status: 'done' }, { status: 'done' }); // false: two different objects
const a = { status: 'done' };
Object.is(a, a); // true: same reference
```

A component's body runs on every render, so `const filters = { status, query }` hands the child a new object every time, and `[items, filters]` always contains a changed dependency.

**Fix in the child: primitive dependencies.**

```tsx
const { status, query } = filters;
const visible = useMemo(() => expensiveFilter(items, { status, query }), [items, status, query]);
```

The function still receives an object, but it is built inside the memoized callback from strings, which compare by value. The child no longer depends on how the parent builds the object. Prefer it when the child is used by parents you don't control.

**Fix in the parent: a stable object.**

```tsx
const filters = useMemo(() => ({ status, query }), [status, query]);
```

The reference now changes only when `status` or `query` change. Prefer it when several consumers receive `filters` (another memoized value, a `React.memo` child, an effect dependency): all of them get the stable reference.

Either fix is enough on its own, and the test proves each one separately. Note `items`: it is a module-level constant, so its reference never changes. If the parent built it with `.filter()` or `.map()` in its body, it would have exactly the same problem.

**How the test counts.** `vi.mock` replaces `./filter` with the same module, but with `expensiveFilter` wrapped in `vi.fn`, so the test counts the real calls the components make. After 5 unrelated updates, the flawed board has called it 6 times (the first render plus 5) and the fixed board once. Another test changes the status and checks that the fixed board does compute again: a cache that never updates would be a bug too.

**The counters in the demo.** `useChangeCount` (in [`src/lib`](../../lib/useChangeCount.ts)) runs an effect whose dependency is the memoized array. `useMemo` returns a new array exactly when it recomputes, so the effect counts recomputations. The number is written straight into the DOM rather than into state, so showing it never causes another render.

**When `useMemo` is not worth it.** It has a cost: memory for the cached value, comparing the dependencies on every render, and code that is harder to read. Use it when the computation is measurably expensive (profile it first), or when the identity of the result matters downstream (a dependency of another hook, a prop of a `React.memo` child). Filtering twenty items does not need it, and primitive values never do.

**With the React Compiler.** The React Compiler memoizes values and JSX at build time, including a `{ status, query }` literal, so with it enabled this bug mostly disappears. You still need to understand it: the compiler skips components that break the Rules of React, and most existing code runs without it.

## Common mistakes

| Symptom                                               | Cause                                                                                                                       |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `useMemo` recomputes on every render                  | An object, array or function dependency created during render, here or in a parent.                                         |
| The memoized value never updates                      | A missing dependency: the callback reads a value that is not in the array. The `react-hooks/exhaustive-deps` rule flags it. |
| `JSON.stringify(filters)` as a dependency "fixes" it  | It serializes on every render and breaks with functions, dates or a different key order. Use primitives or a stable object. |
| Still recomputes after memoizing `filters`            | Another dependency is unstable too, such as `items` built with `.filter()` in the parent's body.                            |
| Everything wrapped in `useMemo` and nothing is faster | Memoizing cheap work only adds cost. Memoize expensive work, or values whose identity is a dependency elsewhere.            |

## Practice

Make the parent also pass a `compare` function for sorting (`(a, b) => a.key.localeCompare(b.key)`) and keep the cache working: decide between `useCallback` in the parent and a module-level constant, and add the test that proves it.
