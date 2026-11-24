import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';

/** Threshold from which a cluster changes size and color. */
export interface ClusterStep {
  minCount: number;
  radius: number;
  color: string;
}

export const CLUSTER_STEPS: ClusterStep[] = [
  { minCount: 0, radius: 16, color: '#7fb8a4' },
  { minCount: 5, radius: 22, color: '#3d8f73' },
  { minCount: 10, radius: 28, color: '#0b6e4f' },
];

/**
 * ['step', ['get', 'point_count'], v0, threshold1, v1, threshold2, v2]
 * step returns v0 below the first threshold and jumps to the next value at each threshold.
 */
export function stepByCount(steps: ClusterStep[], pick: (s: ClusterStep) => number | string): ExpressionSpecification {
  const [first, ...rest] = steps;
  if (!first) throw new Error('At least one cluster step is required');
  const expression: unknown[] = ['step', ['get', 'point_count'], pick(first)];
  for (const step of rest) expression.push(step.minCount, pick(step));
  return expression as ExpressionSpecification;
}
