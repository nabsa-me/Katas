/** Public ICGC services used by the exercises. */

/** ContextMaps vector style (MapLibre Style Spec v8). */
export const ICGC_STYLE = 'https://geoserveis.icgc.cat/contextmaps/icgc.json';

/** Font available on the glyph server of the ICGC style. */
export const ICGC_FONT_BOLD = 'FiraSans-Bold';

/** ICGC base map WMS (supports EPSG:3857). */
export const ICGC_BASE_MAP_WMS = 'https://geoserveis.icgc.cat/servei/catalunya/mapa-base/wms';

/** ICGC geocoder (search, autocomplete and reverse geocoding). */
export const ICGC_GEOCODER = 'https://eines.icgc.cat/geocodificador';

/** Approximate center of Catalonia, as [longitude, latitude]. */
export const CATALONIA_CENTER: [number, number] = [1.7, 41.7];

export const CATALONIA_ZOOM = 7;
