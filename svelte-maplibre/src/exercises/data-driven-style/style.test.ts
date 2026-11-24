import { describe, expect, it } from 'vitest';
import type { FacilityCollection } from '../../lib/facilities';
import { capacityRange, colorByType, FACILITY_TYPES, FALLBACK_COLOR, radiusByCapacity } from './style';

const collection = (capacities: number[]): FacilityCollection => ({
  type: 'FeatureCollection',
  features: capacities.map((capacity, i) => ({
    type: 'Feature',
    id: i,
    geometry: { type: 'Point', coordinates: [2, 41] },
    properties: { name: `F${i}`, type: 'school', capacity, municipality: 'X' },
  })),
});

describe('colorByType', () => {
  it('maps every facility type to its color and ends with a fallback', () => {
    const expr = colorByType() as unknown[];
    expect(expr.slice(0, 2)).toEqual(['match', ['get', 'type']]);
    for (const type of FACILITY_TYPES) {
      const index = expr.indexOf(type.id);
      expect(expr[index + 1]).toBe(type.color);
    }
    expect(expr.at(-1)).toBe(FALLBACK_COLOR);
  });
});

describe('capacityRange', () => {
  it('returns min and max capacity', () => {
    expect(capacityRange(collection([300, 50, 1200]))).toEqual([50, 1200]);
  });

  it('returns [0, 0] for an empty collection', () => {
    expect(capacityRange(collection([]))).toEqual([0, 0]);
  });
});

describe('radiusByCapacity', () => {
  it('builds a linear interpolation between the range limits', () => {
    expect(radiusByCapacity([50, 1200], 5, 16)).toEqual([
      'interpolate',
      ['linear'],
      ['get', 'capacity'],
      50,
      5,
      1200,
      16,
    ]);
  });

  it('falls back to a fixed radius when all values are equal', () => {
    expect(radiusByCapacity([300, 300], 4, 10)).toBe(7);
  });
});
