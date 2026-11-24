import { describe, expect, it } from 'vitest';
import { sleep } from './time';

describe('sleep', () => {
  it('resolves after the given delay', async () => {
    const start = performance.now();
    await sleep(30);
    // Timers may fire a millisecond early on some platforms, hence the small margin.
    expect(performance.now() - start).toBeGreaterThanOrEqual(25);
  });
});
