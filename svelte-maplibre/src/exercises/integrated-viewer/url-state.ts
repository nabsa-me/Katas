import type { FacilityType } from '../../lib/facilities';

export interface ViewState {
  zoom: number;
  lon: number;
  lat: number;
  types: FacilityType[];
  query: string;
}

const ALL_TYPES: FacilityType[] = ['library', 'school', 'health_center', 'sports_center'];

export const DEFAULT_STATE: ViewState = { zoom: 7, lon: 1.7, lat: 41.7, types: ALL_TYPES, query: '' };

/** State → URL parameters. Values are rounded so the URL stays readable and stable. */
export function serializeState(state: ViewState): URLSearchParams {
  const params = new URLSearchParams({
    z: state.zoom.toFixed(2),
    lat: state.lat.toFixed(5),
    lon: state.lon.toFixed(5),
  });
  if (state.types.length !== ALL_TYPES.length) params.set('types', state.types.join(','));
  if (state.query) params.set('q', state.query);
  return params;
}

/** URL parameters → state. Any invalid value falls back to the default: the user writes the URL. */
export function parseState(params: URLSearchParams, defaults: ViewState = DEFAULT_STATE): ViewState {
  const number = (key: string, min: number, max: number, fallback: number) => {
    const raw = params.get(key);
    const value = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
  };

  const rawTypes = params.get('types');
  const types =
    rawTypes === null
      ? defaults.types
      : rawTypes.split(',').filter((t): t is FacilityType => (ALL_TYPES as string[]).includes(t));

  return {
    zoom: number('z', 0, 22, defaults.zoom),
    lat: number('lat', -85, 85, defaults.lat),
    lon: number('lon', -180, 180, defaults.lon),
    types,
    query: params.get('q') ?? defaults.query,
  };
}
