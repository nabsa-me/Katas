# React.memo defeated by inline props

## Statement

An issue table renders one memoized `Row` per issue. Selecting a row should only re-render the row that changed, but the table passes props created inline:

```tsx
const Row = memo(function Row({ issue, selected, style, columns, onSelect }) { … });

<Row
  issue={issue}
  selected={issue.id === selectedId}
  style={{ fontVariantNumeric: 'tabular-nums' }}
  columns={['key', 'title', 'assignee']}
  onSelect={() => setSelectedId(issue.id)}
/>;
```

Symptom: selecting one row renders every row again, as if `memo` were not there. Next to the table, a frame with a "Highlight" toggle renders an expensive summary, and every toggle renders the summary again too. Fix both without changing what the user sees.

## What gets assessed

- What `memo` actually does: a shallow comparison of every prop with `Object.is`.
- Recognising the three classic inline props: object literals, array literals and arrow functions.
- The fixes: constants hoisted out of the component, `useCallback` with a handler that takes the id, and passing content as `children`.
- Proving which rows render, with a counter, before and after.
- Knowing when memoization is not worth it.

## How to approach it, step by step

1. Measure first: count renders per row (React DevTools "Highlight updates" or a counter like the one in the demo) and select a row.
2. For each prop of the memoized component, ask whether it is the same reference as in the previous render. `issue` comes from a module-level array (stable), `selected` is a boolean (compared by value); `style`, `columns` and `onSelect` are new on every render.
3. Hoist what never changes (`style`, `columns`) to module-level constants.
4. Replace the per-row closure with one handler that receives the id, wrapped in `useCallback`.
5. For the frame, move the state into a component that receives the expensive content as `children`.
6. Write tests that click and count renders per row.

## Solution explained

[`IssueTable.problem.tsx`](./IssueTable.problem.tsx) and [`HighlightFrame.problem.tsx`](./HighlightFrame.problem.tsx) are the flawed versions; [`IssueTable.tsx`](./IssueTable.tsx) and [`HighlightFrame.tsx`](./HighlightFrame.tsx) the fixed ones. [`IssueTable.test.tsx`](./IssueTable.test.tsx) and [`HighlightFrame.test.tsx`](./HighlightFrame.test.tsx) count the renders; [`table.ts`](./table.ts) holds the pure helpers, tested in [`table.test.ts`](./table.test.ts).

**What `memo` compares.** `memo(Component)` makes React skip rendering the component when every prop is equal to the previous one, compared with `Object.is` one by one. It is the same rule as `useMemo` dependencies: strings, numbers and booleans compare by value; objects, arrays and functions by reference. A single prop with a new reference is enough to render again.

**Why inline props defeat it.** The table's body runs on every render, and with it `{ … }`, `[ … ]` and `() => …`: three brand-new references per row. The comparison always finds a change, so `memo` only adds the cost of comparing.

**Constants outside the component.**

```tsx
const ROW_STYLE: CSSProperties = { fontVariantNumeric: 'tabular-nums' };
const COLUMNS: Column[] = ['key', 'title', 'assignee'];
```

Created once when the module loads, so every render passes the same reference. Use this for anything that does not depend on props or state. If it did depend on them, the tool would be `useMemo`.

**A stable handler that takes the id.**

```tsx
const toggle = useCallback((id: string) => setSelectedId((current) => (current === id ? null : id)), []);
<Row … onSelect={toggle} />;
```

`useCallback` returns the same function until a dependency changes; there are none, because the setter React returns from `useState` is guaranteed stable and the functional update reads the current value without closing over it. The row calls `onSelect(issue.id)` from its own button: that arrow is new on every row render, but it is passed to a DOM element, which nothing memoizes, so it costs nothing. Selecting a row now changes the `selected` prop of two rows (the old and the new one), and only those render.

**Composition with `children`.** In the flawed frame, the component that owns the `highlighted` state also creates `<IssueSummary />`, so every toggle creates a new summary element and renders it. In the fixed version the frame receives the summary as `children`:

```tsx
<HighlightFrame>
  <IssueSummary items={issues} counterName="Fixed summary" />
</HighlightFrame>
```

When the frame's state changes, React renders the frame again, but `children` is the element object the parent created earlier, with the same props object, and React skips it. No `memo` and no `useCallback`: the content is simply created by a component that does not re-render. The same idea is "move the state down": keep fast-changing state in the smallest component that needs it.

**How it is proven.** `useRenderCount` (in [`src/lib`](../../lib/useRenderCount.ts)) records every committed render in an effect without dependencies, which does not run when `memo` skips the component. After selecting a row, the flawed table has rendered all eight rows twice; the fixed one, one row. Moving the selection renders exactly the old and the new row. After three toggles, the flawed summary has rendered four times and the fixed one once.

**When memoization is not worth it.** `memo` compares every prop on every parent render; if the props almost always change, or the component is cheap, it is pure overhead. It also makes the component depend on every caller passing stable props, which is fragile. Reach for it when a profiler shows a component that renders often, is expensive, and receives props that are usually the same. Composition (`children`, moving state down) is cheaper and should come first. The React Compiler, when enabled, memoizes components and inline values automatically, which makes most manual `memo`/`useCallback` unnecessary.

## Common mistakes

| Symptom                                        | Cause                                                                                                             |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Every memoized row renders on any change       | An inline object, array or function prop, created in the parent's render.                                         |
| `useCallback` everywhere and rows still render | The callback has a dependency that changes on every render (an inline object, or state it should not read).       |
| The handler uses an old value                  | `useCallback` with missing dependencies; use a functional update or include the dependency.                       |
| A `children` prop "breaks" `memo`              | JSX children are a new element on every parent render; `memo` on a component that receives children rarely helps. |
| Memoizing tiny components makes things slower  | The comparison costs more than the render it saves.                                                               |

## Practice

Add a "density" setting (compact or comfortable) to the table that changes the row style, and keep the rows from rendering when an unrelated parent state changes: decide between `useMemo` for the style and passing the density as a string prop.
