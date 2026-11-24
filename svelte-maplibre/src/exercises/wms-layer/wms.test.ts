import { describe, expect, it } from 'vitest';
import { BBOX_PLACEHOLDER, wmsTileUrl } from './wms';

describe('wmsTileUrl', () => {
  const url = wmsTileUrl('https://example.org/wms', 'geologic');
  const params = new URL(url.replace(BBOX_PLACEHOLDER, '0,0,1,1')).searchParams;

  it('requests a WMS 1.3.0 GetMap in EPSG:3857', () => {
    expect(params.get('SERVICE')).toBe('WMS');
    expect(params.get('VERSION')).toBe('1.3.0');
    expect(params.get('REQUEST')).toBe('GetMap');
    expect(params.get('CRS')).toBe('EPSG:3857');
  });

  it('asks for the given layer as a transparent 256 px PNG', () => {
    expect(params.get('LAYERS')).toBe('geologic');
    expect(params.get('FORMAT')).toBe('image/png');
    expect(params.get('TRANSPARENT')).toBe('true');
    expect(params.get('WIDTH')).toBe('256');
    expect(params.get('HEIGHT')).toBe('256');
  });

  it('keeps the bbox placeholder unencoded so MapLibre can replace it', () => {
    expect(url.endsWith('&BBOX={bbox-epsg-3857}')).toBe(true);
  });
});
