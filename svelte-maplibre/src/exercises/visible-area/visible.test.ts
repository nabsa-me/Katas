import type { Feature, Point } from 'geojson';
import { describe, expect, it } from 'vitest';
import { featuresInBbox, isInBbox, type Bbox } from './visible';

const barcelonaArea: Bbox = [2.0, 41.3, 2.3, 41.5];

const feature = (name: string, lon: number, lat: number): Feature<Point, { name: string }> => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties: { name },
});

describe('isInBbox', () => {
  it('accepts a point inside', () => {
    expect(isInBbox([2.17, 41.387], barcelonaArea)).toBe(true);
  });

  it('accepts a point on the edge', () => {
    expect(isInBbox([2.0, 41.3], barcelonaArea)).toBe(true);
  });

  it('rejects a point outside', () => {
    expect(isInBbox([2.82, 41.98], barcelonaArea)).toBe(false);
  });

  it('rejects swapped coordinates (lat, lon)', () => {
    expect(isInBbox([41.387, 2.17], barcelonaArea)).toBe(false);
  });
});

describe('featuresInBbox', () => {
  it('keeps only the features inside, sorted by name', () => {
    const features = [
      feature('El Turonet School', 2.155, 41.403),
      feature('Onyar Library', 2.821, 41.979),
      feature('Àrea Sports Center', 2.1, 41.36),
    ];
    expect(featuresInBbox(features, barcelonaArea).map((f) => f.properties.name)).toEqual([
      'Àrea Sports Center',
      'El Turonet School',
    ]);
  });
});
