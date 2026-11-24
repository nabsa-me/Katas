# Inline value in a Context Provider

## Statement

A session provider shares the current user and a way to change it:

```tsx
export function UserProvider({ children }) {
  const [user, setUser] = useState(INITIAL_USER);
  return <UserContext value={{ user, setUser }}>{children}</UserContext>;
}
```

Two components consume it: `UserName`, which shows the user, and `RenameForm`, which only calls `setUser`. Symptom: every time the provider renders, for any reason, both consumers render again; and every rename renders `RenameForm`, which never shows the user. Make each consumer render only when the part of the context it uses changes.

## What gets assessed

- How context updates work: React compares the provider's `value` with `Object.is` and renders every consumer when it changes.
- Seeing that `value={{ … }}` is a new object on every render of the provider.
- `useMemo` on the value, and why it is not enough on its own.
- Splitting state and actions into two contexts, with a stable `dispatch`.
- Proving it with render counters in a consumer that only uses the actions.

## How to approach it, step by step

1. Count the renders of each consumer and trigger two things: a render of the provider that changes nothing, and a real change of the user.
2. Look at the `value`: an object literal, so every provider render creates a new one.
3. Wrap it in `useMemo` with `[user]`: unrelated provider renders no longer reach the consumers.
4. Notice that a rename still renders `RenameForm`: it subscribes to an object that contains `user`.
5. Split the context: one for the user (changes often), one for the actions (never changes). Use `useReducer`, whose `dispatch` is stable, and memoize the actions object once.
6. Give each context its own hook (`useUser`, `useUserActions`) that throws outside the provider.

## Solution explained

[`UserSession.problem.tsx`](./UserSession.problem.tsx) is the flawed version and [`UserSession.tsx`](./UserSession.tsx) the fixed one; [`UserSession.test.tsx`](./UserSession.test.tsx) counts the renders of both. The state transitions are a pure reducer in [`session.ts`](./session.ts), tested in [`session.test.ts`](./session.test.ts).

**How a context update reaches consumers.** When a provider renders, React compares the new `value` with the previous one using `Object.is`. If it differs, React renders every component that reads that context (`use(Context)` or `useContext(Context)`), wherever it is in the tree, even below a `memo` that would otherwise stop the render. A consumer cannot subscribe to part of a context: it receives the whole value.

**Why `{ user, setUser }` breaks it.** The object literal is created on every render of the provider, so `Object.is` always reports a change. The provider renders whenever its parent renders, so a click anywhere above it renders every consumer, and a context used by many components can become the most expensive thing in the app.

**First fix, `useMemo` on the value.**

```tsx
const value = useMemo(() => ({ user, setUser }), [user]);
```

The object now keeps its reference until `user` changes, so unrelated provider renders stop reaching the consumers. It does not help when the user really changes: the new object still goes to every consumer, including the ones that only use `setUser`.

**Second fix, separate state and actions.**

```tsx
const [user, dispatch] = useReducer(sessionReducer, INITIAL_USER);
const actions = useMemo<UserActions>(() => ({ rename: (name) => dispatch({ type: 'rename', name }) }), []);

<UserActionsContext value={actions}>
  <UserStateContext value={user}>{children}</UserStateContext>
</UserActionsContext>;
```

`dispatch` from `useReducer` (like the setter from `useState`) keeps the same identity for the life of the component, so the actions object is created once and its context never changes. The state context receives `user` itself, which is state: its reference changes only when the reducer returns a new object. `RenameForm` reads only `useUserActions()`, so a rename renders `UserName` and nothing else. The reducer returns the same object when the name does not change, so React skips that update entirely.

**React 19 details.** In React 19 the context object is itself the provider (`<UserContext value={…}>`); `<UserContext.Provider value={…}>` is the older spelling and behaves the same. `use(Context)` reads a context like `useContext`, and unlike it can be called conditionally. The hooks throw when used outside the provider, so a missing provider fails loudly instead of returning `null`.

**What the demo isolates.** In the demo, the consumers sit inside a `memo` component, `Toolbar`. Without it, a render of the panel would render `Toolbar` as a normal child and the consumers with it, whatever the context did. With it, only the context can make them render, which is what the counters measure. In a real app the consumers are usually deep in the tree, behind components that do not re-render for unrelated reasons.

**How it is proven.** After three unrelated updates, the flawed consumers have rendered four times each and the fixed ones once. After a rename, the flawed `RenameForm` renders again and the fixed one does not, while the fixed `UserName` does, as it should.

**When to go further.** Many small contexts, or a context with a value that changes often (a mouse position, a timer), are a sign that state belongs in an external store with selectors (`useSyncExternalStore`, Zustand, Redux): consumers subscribe to the slice they read and render only when that slice changes.

## Common mistakes

| Symptom                                                         | Cause                                                                                    |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Every consumer renders when anything above the provider changes | `value={{ … }}` or `value={[…]}` created during render.                                  |
| Consumers that only dispatch render on every state change       | State and actions in the same context value.                                             |
| `memo` on a consumer does not stop it from rendering            | `memo` only looks at props; a context change always reaches the components that read it. |
| The actions object is recreated after `useMemo`                 | Its dependencies include state, or functions created during render.                      |
| A consumer receives `null` and crashes later                    | Used outside its provider; a hook that throws makes the mistake obvious.                 |

## Practice

Add a `signOut` action and a `SessionTimer` that shows how long the user has been signed in, updating every second: keep the timer's state out of the session context so the other consumers do not render every second.
