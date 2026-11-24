# Code review: common React bugs

## Statement

Five short components arrive in a pull request. Each one works in the happy path and hides a classic React bug. Review them: say what breaks, why, and how to fix it, and prove each fix with a test.

1. **Index as key in a reorderable list.** Rows with a note input and a "Move up" button, rendered with `<li key={index}>`.
2. **State copied from props.** An editor does `const [title, setTitle] = useState(issue.title)`, and the parent switches between issues.
3. **Derived data computed in an effect.** `useEffect(() => setVisible(issues.filter(...)), [assignee])` keeps a filtered list in state.
4. **Race condition when fetching in an effect.** `useEffect(() => { fetchIssue(issueId).then(setIssue) }, [issueId])`, and the user switches issues quickly.
5. **State mutated in place.** `labels.push(label); setLabels(labels)`.

## What gets assessed

- Reading code and explaining the mechanism behind each bug, not only the symptom.
- Keys as identity in reconciliation.
- Deriving values during render instead of synchronising copies with state and effects.
- Cancelling or ignoring stale async work in effect cleanups.
- Immutability: React detects changes by reference.

## How to approach it, step by step

1. For each component, find the line where data enters React state, and ask what keeps it correct when its source changes.
2. Reproduce with a small interaction (type, reorder, switch, add) and write it down as a test that fails.
3. Fix with the smallest change that removes the cause, not the symptom.
4. Keep the test: it now documents the bug and guards the fix.

## Solution explained

Each bug has a flawed component (`*.problem.tsx`), the fixed one, and a test file that runs the same interaction against both. Pure helpers live in [`snippets.ts`](./snippets.ts), tested in [`snippets.test.ts`](./snippets.test.ts).

### Index as key in a reorderable list

Files: [`ReorderableList.problem.tsx`](./ReorderableList.problem.tsx), [`ReorderableList.tsx`](./ReorderableList.tsx), [`ReorderableList.test.tsx`](./ReorderableList.test.tsx).

**Diagnosis.** React matches the children of a list between renders by `key`. With the index as key, after moving the second row up, React sees "key 0 and key 1, same as before" and keeps both `<li>` elements, with their DOM state (the text typed in an uncontrolled input, focus, scroll) and the state of any component inside them. Only the props change, so the labels swap while the typed note stays at its old position, next to the wrong issue.

**Fix.** `key={issue.id}`: a stable identity that travels with the item, so React moves the existing `<li>` instead of relabelling it. The index is acceptable only for lists that never reorder, filter or insert, and whose rows hold no state.

**Test.** Type "blocked" in the second row's note and move that row up: the problem leaves "blocked" next to the first issue, the fix keeps it with its own.

### State copied from props

Files: [`IssueEditor.problem.tsx`](./IssueEditor.problem.tsx), [`IssueEditor.tsx`](./IssueEditor.tsx), [`IssueEditor.test.tsx`](./IssueEditor.test.tsx).

**Diagnosis.** `useState(initialValue)` uses its argument only on the first render. When the parent passes a different issue, the editor re-renders with the new prop, but its state keeps the old title. Two sources of truth now disagree.

**Fix, depending on intent.** If the value is only displayed, do not copy it: read `issue.title` during render (the selected issue itself is derived during render from `selectedId`, instead of being stored). If it is an editable draft that should restart for each issue, keep the state and give the editor `key={issue.id}`: a different key is a different component instance for React, so its state starts again from the new prop. Avoid the third option people reach for, an effect that copies the prop into state on change: it renders the stale value first and then renders again.

**Test.** Select the second issue: the problem still shows the first title; the fix shows the second, even after the first title was edited.

### Derived data computed in an effect

Files: [`AssigneeIssues.problem.tsx`](./AssigneeIssues.problem.tsx), [`AssigneeIssues.tsx`](./AssigneeIssues.tsx), [`AssigneeIssues.test.tsx`](./AssigneeIssues.test.tsx).

**Diagnosis.** The filtered list is stored in state and recomputed in an effect. Effects run after the commit, so every change first paints the previous list (on mount, an empty one), then the effect sets the new list and triggers a second render. The `react-hooks/set-state-in-effect` lint rule reports this pattern; the flawed file disables it on purpose, with a comment.

**Fix.** Compute it during render: `const visible = issuesFor(issues, assignee)`. It is always consistent with the state it comes from, renders once per change, and needs no extra state. Use `useMemo` only when profiling shows the computation is expensive. Effects are for synchronising with things outside React (the DOM, a timer, a subscription, the network), not for transforming data React already has.

**Test.** Render counters: the problem renders twice on mount and twice per change; the fix once.

### Race condition when fetching in an effect

Files: [`IssueDetails.problem.tsx`](./IssueDetails.problem.tsx), [`IssueDetails.tsx`](./IssueDetails.tsx), [`IssueDetails.test.tsx`](./IssueDetails.test.tsx), and [`fake-issue-api.ts`](./fake-issue-api.ts) for the demo.

**Diagnosis.** Switching from issue A to issue B starts a second request, but nothing stops the first one. If A's response arrives after B's, `setIssue(A)` runs last and the panel shows A while B is selected. Network latency makes the order unpredictable.

**Fix.** The effect's cleanup runs before the effect runs again for the new id, and on unmount:

```tsx
useEffect(() => {
  const controller = new AbortController();
  fetchIssue(issueId, controller.signal)
    .then((issue) => {
      if (!controller.signal.aborted) setResult({ id: issueId, issue });
    })
    .catch((error) => {
      if (!controller.signal.aborted) setResult({ id: issueId, error: String(error) });
    });
  return () => controller.abort();
}, [issueId, fetchIssue]);
```

`abort()` cancels the old request when the fetcher supports it (`fetch` does, and rejects with an `AbortError`, which is ignored). The `aborted` check covers fetchers that resolve anyway. The result is stored with the id it belongs to and the "loading" state is derived (`result?.id === issueId`), so there is no synchronous `setState` in the effect and the panel never shows the previous issue while the new one loads. In real apps, a data library (TanStack Query, SWR) or the framework's data loading (route loaders, Server Components) handles this, along with caching and retries.

**Test.** The test controls when each response arrives and, like the worst server, resolves even aborted requests. It asks for A, then B, answers B and then A: the problem ends on A, the fix on B, and the request for A was aborted.

### State mutated in place

Files: [`LabelEditor.problem.tsx`](./LabelEditor.problem.tsx), [`LabelEditor.tsx`](./LabelEditor.tsx), [`LabelEditor.test.tsx`](./LabelEditor.test.tsx).

**Diagnosis.** `labels.push(label)` changes the array that is already in state, and `setLabels(labels)` passes the same reference back. React compares the new state with the old one using `Object.is`, finds them identical and skips the render. The label is in the array but not on screen until something else renders the component, which makes the bug look random. No lint rule reports it, so it has to be caught in review or by a test.

**Fix.** Always produce a new value: `setLabels((current) => addLabel(current, draft))`, where `addLabel` returns `[...current, label]`. Returning the same array when there is nothing to add (empty or duplicated label) is the useful side of the same rule: React skips the render on purpose. The same applies to objects (`{ ...user, name }`) and nested data.

**Test.** Add "urgent" through the form: the problem still lists only "backend"; the fix lists both.

## Common mistakes

| Symptom                                                   | Cause                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------- |
| Inputs or row state jump to another item after a reorder  | Index (or a random value) as `key`.                                       |
| A form shows data from the previously selected item       | State initialised from props and never reset; use derivation or a `key`.  |
| A flash of stale or empty content, then the right content | Derived data stored in state and updated in an effect.                    |
| The wrong record shows up after switching quickly         | No cancellation or stale-response guard in a fetching effect.             |
| An update "sometimes" does not show until another click   | State mutated in place and set with the same reference.                   |
| `key={Math.random()}` "fixes" the list                    | It remounts every row on every render: all state is lost, and it is slow. |

## Practice

Add a sixth snippet to the review: a `useEffect` that subscribes to `window` `resize` and never unsubscribes. Write the flawed version, the fix with a cleanup (or `useSyncExternalStore`), and a test that unmounts the component and checks that no listener is left.
