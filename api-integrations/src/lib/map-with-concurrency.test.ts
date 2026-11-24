import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from './map-with-concurrency';

/** Tracks how many calls are running at the same time. */
function inFlightTracker() {
  let current = 0;
  let max = 0;
  return {
    get max() {
      return max;
    },
    async run<R>(work: () => Promise<R>): Promise<R> {
      current++;
      max = Math.max(max, current);
      try {
        return await work();
      } finally {
        current--;
      }
    },
  };
}

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('mapWithConcurrency', () => {
  it('never runs more than `limit` calls at once', async () => {
    const tracker = inFlightTracker();
    const items = Array.from({ length: 12 }, (_, i) => i);
    await mapWithConcurrency(items, 4, (item) => tracker.run(() => tick(5 + (item % 3))));
    expect(tracker.max).toBe(4);
  });

  it('keeps the results in input order even when calls finish out of order', async () => {
    const delays = [30, 5, 20, 1, 10];
    const results = await mapWithConcurrency(delays, 2, async (ms, index) => {
      await tick(ms);
      return `item ${index}`;
    });
    expect(results).toEqual(['item 0', 'item 1', 'item 2', 'item 3', 'item 4']);
  });

  it('returns an empty array for no items', async () => {
    expect(await mapWithConcurrency([], 3, async () => 1)).toEqual([]);
  });

  it('rejects with the first error and stops taking new items', async () => {
    const started: number[] = [];
    const run = mapWithConcurrency([0, 1, 2, 3, 4, 5], 2, async (item) => {
      started.push(item);
      await tick(1);
      if (item === 1) throw new Error('boom');
      return item;
    });
    await expect(run).rejects.toThrow('boom');
    expect(started).toEqual([0, 1, 2]);
  });

  it('rejects a limit that is not a positive integer', async () => {
    await expect(mapWithConcurrency([1], 0, async (x) => x)).rejects.toThrow(RangeError);
    await expect(mapWithConcurrency([1], 1.5, async (x) => x)).rejects.toThrow(RangeError);
  });
});
