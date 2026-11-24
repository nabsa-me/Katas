import type { FeatureCollection, Point } from 'geojson';
import proj4 from 'proj4';
import type { FacilityCollection, FacilityProps } from '../../lib/facilities';

/** ETRS89 / UTM zone 31N: the official system for mapping in Catalonia. */
export const EPSG_25831 = 'EPSG:25831';
proj4.defs(EPSG_25831, '+proj=utm +zone=31 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs');

const toWgs84 = proj4(EPSG_25831, 'EPSG:4326');

/**
 * Approximate extent of Catalonia in UTM 31N (metres), with a margin.
 * Used to detect data that claims to be in 25831 but comes in another system.
 */
export const CATALONIA_UTM_RANGE = { minX: 240_000, maxX: 540_000, minY: 4_470_000, maxY: 4_760_000 };

export function utmToLonLat([x, y]: [number, number]): [number, number] {
  const [lon, lat] = toWgs84.forward([x, y]);
  return [lon!, lat!];
}

export function lonLatToUtm([lon, lat]: [number, number]): [number, number] {
  const [x, y] = toWgs84.inverse([lon, lat]);
  return [x!, y!];
}

/** Reads the CRS declared GeoJSON 2008 style (`crs.properties.name`), which QGIS and other GIS still write. */
export function declaredCrs(collection: { crs?: unknown }): string | null {
  const crs = collection.crs as { properties?: { name?: unknown } } | undefined;
  const name = crs?.properties?.name;
  return typeof name === 'string' ? name : null;
}

export function isEpsg25831(crsName: string | null): boolean {
  return crsName !== null && /EPSG:{1,2}25831$/.test(crsName);
}

/**
 * Converts a collection of points in EPSG:25831 to EPSG:4326 (lon, lat), ready for MapLibre.
 * Fails explicitly if the CRS is not the expected one or a point falls outside Catalonia.
 */
export function reprojectFacilities(
  collection: FeatureCollection<Point, FacilityProps> & { crs?: unknown },
): FacilityCollection {
  const crs = declaredCrs(collection);
  if (!isEpsg25831(crs)) throw new Error(`Expected EPSG:25831 data, got ${crs ?? 'no CRS'}`);

  return {
    type: 'FeatureCollection',
    features: collection.features.map((feature) => {
      const [x, y] = feature.geometry.coordinates as [number, number];
      const r = CATALONIA_UTM_RANGE;
      if (x < r.minX || x > r.maxX || y < r.minY || y > r.maxY) {
        throw new Error(`Feature ${String(feature.id)} is outside Catalonia in EPSG:25831 (${x}, ${y})`);
      }
      return { ...feature, geometry: { type: 'Point', coordinates: utmToLonLat([x, y]) } };
    }),
  };
}
