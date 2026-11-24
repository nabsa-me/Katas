/**
 * Waits `ms` milliseconds. Clients receive it as a dependency (with `random` and `now`) so that tests can record
 * the delays they ask for and assert on them, instead of waiting for real or patching timers.
 */
export type Sleep = (ms: number) => Promise<void>;

/** A number in `[0, 1)`, like `Math.random`. Injected so jitter is deterministic in tests. */
export type Random = () => number;

/** Milliseconds since the epoch, like `Date.now`. Injected so time windows can be tested. */
export type Clock = () => number;

export const sleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
