/**
 * Counts events by name: how many times a component committed a render, or how many times a memoized
 * value was recomputed. The demo shows the counts next to each component and the tests assert on them.
 * It lives outside React on purpose: storing the count in state would itself cause another render.
 */
export interface RenderLog {
  /** Adds one to `name` and returns the new count. */
  record(name: string): number;
  count(name: string): number;
  reset(): void;
}

export function createRenderLog(): RenderLog {
  const counts = new Map<string, number>();
  return {
    record(name) {
      const next = (counts.get(name) ?? 0) + 1;
      counts.set(name, next);
      return next;
    },
    count(name) {
      return counts.get(name) ?? 0;
    },
    reset() {
      counts.clear();
    },
  };
}

/** Shared by the demo app and the tests (the tests reset it after each case). */
export const renderLog = createRenderLog();
