import { describe, expect, it } from 'vitest';
import type { Facility, FacilityType } from '../../lib/facilities';
import { filterFacilities, normalize } from './filter';

const facility = (name: string, type: FacilityType, municipality: string): Facility => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [2, 41] },
  properties: { name, type, capacity: 100, municipality },
});

const all: FacilityType[] = ['library', 'school', 'health_center', 'sports_center'];

const features = [
  facility('Onyar Library', 'library', 'Girona'),
  facility('Els Til·lers School', 'school', 'Sabadell'),
  facility('Pardinyes Health Center', 'health_center', 'Lleida'),
  facility('Ribes Roges Sports Center', 'sports_center', 'Vilanova i la Geltrú'),
];

const names = (list: Facility[]) => list.map((f) => f.properties.name);

describe('normalize', () => {
  it('removes accents and case', () => {
    expect(normalize('  Àrea Geltrú ')).toBe('area geltru');
  });
});

describe('filterFacilities', () => {
  it('keeps everything with all types and no query', () => {
    expect(filterFacilities(features, { types: all, query: '' })).toHaveLength(4);
  });

  it('filters by type', () => {
    expect(names(filterFacilities(features, { types: ['school'], query: '' }))).toEqual(['Els Til·lers School']);
  });

  it('shows nothing when no type is selected', () => {
    expect(filterFacilities(features, { types: [], query: '' })).toEqual([]);
  });

  it('searches the name ignoring accents and case', () => {
    expect(names(filterFacilities(features, { types: all, query: 'onyar' }))).toEqual(['Onyar Library']);
  });

  it('searches the municipality too', () => {
    expect(names(filterFacilities(features, { types: all, query: 'geltru' }))).toEqual(['Ribes Roges Sports Center']);
  });

  it('combines type and query', () => {
    expect(filterFacilities(features, { types: ['school'], query: 'onyar' })).toEqual([]);
  });
});
