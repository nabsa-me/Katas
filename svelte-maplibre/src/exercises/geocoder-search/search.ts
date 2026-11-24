export interface SearchResult {
  label: string;
  type: string;
  municipality: string;
  lon: number;
  lat: number;
}

export const MIN_CHARS = 3;
export const DEBOUNCE_MS = 300;

export function autocompleteUrl(baseUrl: string, text: string, size = 8): string {
  const params = new URLSearchParams({ text, size: String(size) });
  return `${baseUrl}/autocompletar?${params.toString()}`;
}

/**
 * Turns the ICGC geocoder response (a GeoJSON FeatureCollection) into flat results.
 * Anything without a valid point is dropped: external data is never trusted.
 * The response field names (`nom`, `etiqueta`, `municipi`, `addendum.tipus`) are the service's own.
 */
export function parseResults(json: unknown): SearchResult[] {
  if (!isRecord(json) || !Array.isArray(json.features)) return [];
  const results: SearchResult[] = [];
  for (const feature of json.features) {
    if (!isRecord(feature) || !isRecord(feature.geometry) || !isRecord(feature.properties)) continue;
    const { geometry, properties } = feature;
    if (geometry.type !== 'Point' || !Array.isArray(geometry.coordinates)) continue;
    const [lon, lat] = geometry.coordinates;
    if (typeof lon !== 'number' || typeof lat !== 'number') continue;
    const addendum = isRecord(properties.addendum) ? properties.addendum : {};
    results.push({
      label: text(properties.etiqueta) || text(properties.nom),
      type: text(addendum.tipus),
      municipality: text(properties.municipi),
      lon,
      lat,
    });
  }
  return results;
}

/** Active index after pressing an arrow key. -1 means none. Wraps around at both ends. */
export function nextActiveIndex(current: number, key: 'ArrowDown' | 'ArrowUp', length: number): number {
  if (length === 0) return -1;
  if (key === 'ArrowDown') return current >= length - 1 ? 0 : current + 1;
  return current <= 0 ? length - 1 : current - 1;
}

/** Delays the call until `ms` have passed without new calls. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    call(...args: A) {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    },
    cancel() {
      clearTimeout(timer);
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
