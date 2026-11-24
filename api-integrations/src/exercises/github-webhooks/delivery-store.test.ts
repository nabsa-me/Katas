import { describe, expect, it } from 'vitest';
import { createInMemoryDeliveryStore } from './delivery-store';

describe('createInMemoryDeliveryStore', () => {
  it('claims an id once', async () => {
    const store = createInMemoryDeliveryStore();
    expect(await store.claim('delivery-1')).toBe(true);
    expect(await store.claim('delivery-1')).toBe(false);
    expect(await store.claim('delivery-2')).toBe(true);
  });

  it('lets exactly one of many simultaneous claims win', async () => {
    const store = createInMemoryDeliveryStore();
    const results = await Promise.all(Array.from({ length: 10 }, () => store.claim('delivery-1')));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('can claim an id again after releasing it', async () => {
    const store = createInMemoryDeliveryStore();
    await store.claim('delivery-1');
    await store.release('delivery-1');
    expect(await store.claim('delivery-1')).toBe(true);
  });
});
