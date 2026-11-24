import type { Feature, Point } from 'geojson';
import { describe, expect, it } from 'vitest';
import type { FacilityProps } from '../../lib/facilities';
import { isEpsg25831, lonLatToUtm, reprojectFacilities, utmToLonLat } from './reproject';

// Reference values computed with PROJ (pyproj), not with proj4js.
const PL_CATALUNYA = { lonLat: [2.17, 41.387] as [number, number], utm: [430605.306, 4582051.505] as [number, number] };
const LLEIDA = { lonLat: [0.62, 41.6176] as [number, number], utm: [301711.559, 4610056.265] as [number, number] };

const CM = 0.01; // tolerance in metres
const DEG_CM = 1e-7; // ~1 cm in degrees at these latitudes

describe('lonLatToUtm', () => {
  it.each([PL_CATALUNYA, LLEIDA])('matches PROJ within 1 cm', ({ lonLat, utm }) => {
    const [x, y] = lonLatToUtm(lonLat);
    expect(Math.abs(x - utm[0])).toBeLessThan(CM);
    expect(Math.abs(y - utm[1])).toBeLessThan(CM);
  });
});

describe('utmToLonLat', () => {
  it.each([PL_CATALUNYA, LLEIDA])('matches PROJ within about 1 cm', ({ lonLat, utm }) => {
    const [lon, lat] = utmToLonLat(utm);
    expect(Math.abs(lon - lonLat[0])).toBeLessThan(DEG_CM);
    expect(Math.abs(lat - lonLat[1])).toBeLessThan(DEG_CM);
  });
});

describe('isEpsg25831', () => {
  it('accepts the usual spellings', () => {
    expect(isEpsg25831('EPSG:25831')).toBe(true);
    expect(isEpsg25831('urn:ogc:def:crs:EPSG::25831')).toBe(true);
  });

  it('rejects other systems', () => {
    expect(isEpsg25831('EPSG:23031')).toBe(false);
    expect(isEpsg25831(null)).toBe(false);
  });
});

describe('reprojectFacilities', () => {
  const props: FacilityProps = { name: 'X', type: 'school', capacity: 1, municipality: 'Barcelona' };
  const feature = (coordinates: number[]): Feature<Point, FacilityProps> => ({
    type: 'Feature',
    id: 1,
    geometry: { type: 'Point', coordinates },
    properties: props,
  });
  const crs = { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::25831' } };

  it('converts points to lon/lat and keeps id and properties', () => {
    const result = reprojectFacilities({ type: 'FeatureCollection', crs, features: [feature(PL_CATALUNYA.utm)] });
    const [lon, lat] = result.features[0]!.geometry.coordinates as [number, number];
    expect(lon).toBeCloseTo(2.17, 6);
    expect(lat).toBeCloseTo(41.387, 6);
    expect(result.features[0]!.id).toBe(1);
    expect(result.features[0]!.properties).toEqual(props);
  });

  it('rejects data without the expected CRS', () => {
    expect(() => reprojectFacilities({ type: 'FeatureCollection', features: [] })).toThrow(/EPSG:25831/);
  });

  it('rejects data that is really in degrees although it says 25831', () => {
    expect(() => reprojectFacilities({ type: 'FeatureCollection', crs, features: [feature([2.17, 41.387])] })).toThrow(
      /outside Catalonia/,
    );
  });
});
