import type { Feature, Point } from 'geojson';

/** [west, south, east, north] in degrees, the same order as a GeoJSON bbox. */
export type Bbox = [number, number, number, number];

export function isInBbox([lon, lat]: number[], [west, south, east, north]: Bbox): boolean {
  if (lon === undefined || lat === undefined) return false;
  return lon >= west && lon <= east && lat >= south && lat <= north;
}

/**
 * Features whose point falls inside the bbox, sorted by name.
 * Catalan collation, because the names are Catalan proper nouns ("Àger" sorts with "A").
 */
export function featuresInBbox<P extends { name: string }>(
  features: Feature<Point, P>[],
  bbox: Bbox,
): Feature<Point, P>[] {
  return features
    .filter((f) => isInBbox(f.geometry.coordinates, bbox))
    .sort((a, b) => a.properties.name.localeCompare(b.properties.name, 'ca'));
}
