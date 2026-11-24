/**
 * The nearest-rank percentile: the smallest value such that at least `p` % of the values are less than or equal to
 * it. It always returns one of the measured values (no interpolation), which is what latency reports usually mean
 * by "p95". `undefined` for an empty list.
 */
export function percentile(values: readonly number[], p: number): number | undefined {
  if (!(p > 0 && p <= 100)) throw new RangeError(`percentile must be in (0, 100], got ${p}`);
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[rank - 1];
}
