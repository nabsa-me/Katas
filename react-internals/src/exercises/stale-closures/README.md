# Stale closures

## Statement

A ticker should add one to a counter every second:

```tsx
const [count, setCount] = useState(0);

useEffect(() => {
  const id = setInterval(() => setCount(count + 1), 1000);
  return () => clearInterval(id);
}, []);
```

Symptom: the counter goes from 0 to 1 and stays at 1 forever. Fix it, then make the ticker take a `step` that can change while it runs (without restarting the timer) and a `delay` that can be `null` to pause it.

## What gets assessed

- What a closure captures in a function component: the values of **the render that created it**.
- Functional updates (`setCount((c) => c + 1)`) as the way to read the current state without capturing it.
- Correct effect dependencies, and why "just add `count` to the array" is the wrong fix here.
- Keeping the latest callback in a ref (or, since React 19.2, `useEffectEvent`) to read fresh values without restarting an effect.
- Testing timers with fake timers.

## How to approach it, step by step

1. Ask what `count` is inside the interval callback: the `count` of the render that ran the effect. The empty dependency array means the effect ran once, in the first render, where `count` was 0.
2. Notice that the lint rule `react-hooks/exhaustive-deps` already warns about it: `count` is used but not listed.
3. Replace `setCount(count + 1)` with `setCount((c) => c + 1)`: the callback no longer needs `count` at all, and the empty array is now correct.
4. For a `step` prop that changes over time, avoid putting `step` in the dependencies (it would restart the interval on every change). Keep the latest callback in a ref and call it from a stable interval: extract a `useInterval(callback, delay)` hook.
5. Make `delay` the only dependency of the interval, and treat `null` as "paused".
6. Test with `vi.useFakeTimers()` and `act`.

## Solution explained

[`Ticker.problem.tsx`](./Ticker.problem.tsx) is the flawed ticker; [`Ticker.tsx`](./Ticker.tsx) the fixed one, built on [`useInterval.ts`](./useInterval.ts). [`Ticker.test.tsx`](./Ticker.test.tsx) proves both with fake timers.

**What a closure captures.** Each render of a function component is a separate call of that function, with its own `count` constant. A function created during a render (an event handler, an effect, an interval callback) sees the variables of that call, forever. The effect with `[]` runs once, after the first render, so its interval callback sees `count === 0` and computes `0 + 1` on every tick. React does re-render with `count === 1`, but the interval still holds the old callback.

**Fix 1: the functional update.**

```tsx
useInterval(() => setCount((current) => current + step), delay);
```

Passing a function to the setter tells React "compute the next state from whatever the current state is". The callback no longer reads `count`, so it cannot read a stale one. This alone fixes the original bug with the original `[]` dependencies.

**Why not just add `count` to the dependencies.** With `[count]` the counter works, but the effect now runs after every tick: it clears the interval and creates a new one. The timer restarts every second, drifts, and with a short delay or a slow render it can skip ticks. The dependency array should list what the effect really needs to restart for, and an interval only needs to restart when its delay changes.

**Fix 2: the latest callback in a ref.** `step` can change while the ticker runs. Putting `step` in the dependencies would restart the interval on every change. Instead, [`useInterval`](./useInterval.ts) keeps the most recent callback in a ref and the interval calls `latest.current()`:

```ts
const latest = useRef(callback);
useEffect(() => {
  latest.current = callback;
});
useEffect(() => {
  if (delay === null) return;
  const id = setInterval(() => latest.current(), delay);
  return () => clearInterval(id);
}, [delay]);
```

A ref is a mutable box that survives renders without causing them. The first effect points it at the callback of the last committed render; it is written in an effect, not during render, because a render can be discarded before it commits (and the `react-hooks/refs` rule forbids writing refs during render). The interval effect depends only on `delay`, so changing `step` does not touch the timer, and the next tick already uses the new step.

**The built-in alternative: `useEffectEvent`.** React 19.2 made `useEffectEvent` stable. It returns a function that always sees the latest props and state, and that is not a dependency:

```tsx
const onTick = useEffectEvent(() => setCount((current) => current + step));
useEffect(() => {
  if (delay === null) return;
  const id = setInterval(() => onTick(), delay);
  return () => clearInterval(id);
}, [delay]);
```

It replaces the ref pattern for this case. The ref version is shown because it works in any React version and makes the mechanism visible.

**How it is proven.** The tests use fake timers, so seconds pass instantly and deterministically: after 3 s the flawed ticker shows 1 and the fixed one 3. A test changes `step` halfway between two ticks and checks that the next tick arrives on time with the new step and that `setInterval` was called only once (no restart). Another passes `delay={null}`, advances five seconds without changes, and resumes.

## Common mistakes

| Symptom                                                 | Cause                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| A counter stuck at 1                                    | `setCount(count + 1)` inside a callback created in an old render.                           |
| A handler shows an old value after a `setTimeout`       | The same capture: the timeout callback belongs to the render that scheduled it.             |
| The interval restarts and drifts on every tick          | `count` (or the callback) in the dependency array of the effect that creates the interval.  |
| A ref holds an old value                                | It is never updated, or it is updated during render instead of in an effect.                |
| `exhaustive-deps` silenced and the bug comes back later | The warning was pointing at a real stale value; fix the dependency instead of disabling it. |

## Practice

Add a "reset" button that sets the counter back to zero without restarting the interval, and a test with fake timers that proves the next tick still arrives on schedule.
