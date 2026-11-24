import { describe, expect, it } from 'vitest';
import { CLUSTER_STEPS, stepByCount } from './cluster';

describe('stepByCount', () => {
  it('builds a step expression on point_count for the radius', () => {
    expect(stepByCount(CLUSTER_STEPS, (s) => s.radius)).toEqual(['step', ['get', 'point_count'], 16, 5, 22, 10, 28]);
  });

  it('builds a step expression on point_count for the color', () => {
    expect(stepByCount(CLUSTER_STEPS, (s) => s.color)).toEqual([
      'step',
      ['get', 'point_count'],
      '#7fb8a4',
      5,
      '#3d8f73',
      10,
      '#0b6e4f',
    ]);
  });

  it('rejects an empty list of steps', () => {
    expect(() => stepByCount([], (s) => s.radius)).toThrow();
  });
});
