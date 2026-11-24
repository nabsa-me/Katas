/**
 * Maps `items` with an async `fn`, running at most `limit` calls at a time, and returns the results in input order.
 *
 * `Promise.all(items.map(fn))` starts every call at once: 200 issue keys become 200 simultaneous requests, which is
 * exactly the burst that rate limiters answer with 429. Here `limit` workers pull the next item as soon as they
 * finish the previous one, so the API never sees more than `limit` requests in flight.
 *
 * It fails fast like `Promise.all`: the first rejection rejects the call and the workers stop taking new items
 * (calls already in flight are left to finish).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError(`limit must be a positive integer, got ${limit}`);

  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let failed = false;

  async function worker(): Promise<void> {
    while (!failed && nextIndex < items.length) {
      // Reading and incrementing happen in the same synchronous step, so two workers never take the same item.
      const index = nextIndex++;
      try {
        results[index] = await fn(items[index] as T, index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
