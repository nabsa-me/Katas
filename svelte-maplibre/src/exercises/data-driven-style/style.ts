import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { FacilityCollection, FacilityType } from '../../lib/facilities';

/** Single source of truth: used by both the map style and the legend. */
export const FACILITY_TYPES: { id: FacilityType; label: string; color: string }[] = [
  { id: 'library', label: 'Library', color: '#1b6ca8' },
  { id: 'school', label: 'School', color: '#e08a00' },
  { id: 'health_center', label: 'Health center', color: '#c62f3b' },
  { id: 'sports_center', label: 'Sports center', color: '#2e8540' },
];

export const FALLBACK_COLOR = '#7a7a7a';

/** ['match', ['get', 'type'], 'library', '#1b6ca8', ..., FALLBACK_COLOR] */
export function colorByType(): ExpressionSpecification {
  const pairs = FACILITY_TYPES.flatMap((t) => [t.id, t.color]);
  // MapLibre's type cannot check a variable number of pairs: build it as an array and cast it.
  const expression: unknown[] = ['match', ['get', 'type'], ...pairs, FALLBACK_COLOR];
  return expression as ExpressionSpecification;
}

export function capacityRange(collection: FacilityCollection): [number, number] {
  const values = collection.features.map((f) => f.properties.capacity);
  if (values.length === 0) return [0, 0];
  return [Math.min(...values), Math.max(...values)];
}

/**
 * Radius linearly interpolated between the minimum and maximum capacity.
 * If every value is the same, a fixed radius (interpolate needs increasing stops).
 */
export function radiusByCapacity(
  [min, max]: [number, number],
  minRadius = 5,
  maxRadius = 16,
): ExpressionSpecification | number {
  if (min === max) return (minRadius + maxRadius) / 2;
  return ['interpolate', ['linear'], ['get', 'capacity'], min, minRadius, max, maxRadius];
}
