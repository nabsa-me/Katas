import type { Facility, FacilityType } from '../../lib/facilities';

/** Lower case and no accents: "Àrea" and "area" are treated as equal when searching. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

export interface FacilityFilter {
  types: FacilityType[];
  query: string;
}

/** With no type selected nothing is shown; the query matches name and municipality. */
export function filterFacilities(features: Facility[], { types, query }: FacilityFilter): Facility[] {
  const q = normalize(query);
  return features.filter((f) => {
    if (!types.includes(f.properties.type)) return false;
    if (!q) return true;
    return normalize(f.properties.name).includes(q) || normalize(f.properties.municipality).includes(q);
  });
}
