import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { autocompleteUrl, debounce, nextActiveIndex, parseResults } from './search';

describe('autocompleteUrl', () => {
  it('encodes the text and the size', () => {
    expect(autocompleteUrl('https://g.example', 'la seu', 5)).toBe(
      'https://g.example/autocompletar?text=la+seu&size=5',
    );
  });
});

describe('parseResults', () => {
  // Same shape as the real ICGC geocoder response.
  const response = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [1.0569, 41.0687] },
        properties: {
          nom: 'Cambrils',
          etiqueta: 'Cambrils',
          municipi: 'Cambrils',
          comarca: 'Baix Camp',
          addendum: { tipus: 'Cap de municipi' },
        },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [1.53, 42.06] },
        properties: { nom: 'Cambrils', etiqueta: 'Cambrils, Odèn', municipi: 'Odèn' },
      },
    ],
  };

  it('maps features to flat results in lon/lat order', () => {
    expect(parseResults(response)).toEqual([
      { label: 'Cambrils', type: 'Cap de municipi', municipality: 'Cambrils', lon: 1.0569, lat: 41.0687 },
      { label: 'Cambrils, Odèn', type: '', municipality: 'Odèn', lon: 1.53, lat: 42.06 },
    ]);
  });

  it('falls back to the name when there is no label', () => {
    const [result] = parseResults({
      features: [{ geometry: { type: 'Point', coordinates: [2, 41] }, properties: { nom: 'Vic' } }],
    });
    expect(result?.label).toBe('Vic');
  });

  it('skips features without a valid point', () => {
    expect(
      parseResults({
        features: [
          { geometry: { type: 'LineString', coordinates: [] }, properties: {} },
          { geometry: { type: 'Point', coordinates: ['2', 41] }, properties: {} },
          { properties: {} },
        ],
      }),
    ).toEqual([]);
  });

  it('returns no results for unexpected payloads', () => {
    expect(parseResults(null)).toEqual([]);
    expect(parseResults({ error: 'x' })).toEqual([]);
  });
});

describe('nextActiveIndex', () => {
  it('moves down and wraps to the first item', () => {
    expect(nextActiveIndex(-1, 'ArrowDown', 3)).toBe(0);
    expect(nextActiveIndex(1, 'ArrowDown', 3)).toBe(2);
    expect(nextActiveIndex(2, 'ArrowDown', 3)).toBe(0);
  });

  it('moves up and wraps to the last item', () => {
    expect(nextActiveIndex(-1, 'ArrowUp', 3)).toBe(2);
    expect(nextActiveIndex(0, 'ArrowUp', 3)).toBe(2);
    expect(nextActiveIndex(2, 'ArrowUp', 3)).toBe(1);
  });

  it('returns -1 when there are no items', () => {
    expect(nextActiveIndex(0, 'ArrowDown', 0)).toBe(-1);
  });
});

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('calls once with the last arguments after the delay', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 300);
    debounced.call('g');
    debounced.call('gi');
    debounced.call('gir');
    vi.advanceTimersByTime(299);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith('gir');
  });

  it('does not call after cancel', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 300);
    debounced.call('x');
    debounced.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });
});
