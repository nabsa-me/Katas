/** Layers of the ICGC base map WMS (from its GetCapabilities). */
export const WMS_LAYERS = [
  { id: 'geologic', label: 'Geological map' },
  { id: 'orto', label: 'Orthophoto' },
  { id: 'administratiu', label: 'Administrative map' },
  { id: 'topografic-gris', label: 'Grey topographic map' },
] as const;

export type WmsLayerId = (typeof WMS_LAYERS)[number]['id'];

/** Placeholder that MapLibre replaces with each tile's bbox in EPSG:3857. */
export const BBOX_PLACEHOLDER = '{bbox-epsg-3857}';

/**
 * GetMap URL for a MapLibre raster source.
 * WMS 1.3.0 uses CRS (it was SRS in 1.1.1). In EPSG:3857 the axis order is x, y.
 */
export function wmsTileUrl(baseUrl: string, layer: string, tileSize = 256): string {
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetMap',
    LAYERS: layer,
    STYLES: '',
    CRS: 'EPSG:3857',
    WIDTH: String(tileSize),
    HEIGHT: String(tileSize),
    FORMAT: 'image/png',
    TRANSPARENT: 'true',
  });
  // The placeholder is appended by hand: URLSearchParams would encode the braces and MapLibre would not recognise it.
  return `${baseUrl}?${params.toString()}&BBOX=${BBOX_PLACEHOLDER}`;
}
