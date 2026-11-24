import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE, parseState, serializeState, type ViewState } from './url-state';

describe('serializeState / parseState', () => {
  it('round-trips a full state', () => {
    const state: ViewState = { zoom: 11.5, lon: 2.17, lat: 41.387, types: ['school', 'library'], query: 'gràcia' };
    expect(parseState(serializeState(state))).toEqual(state);
  });

  it('omits the types when all are selected and the query when empty', () => {
    const params = serializeState(DEFAULT_STATE);
    expect(params.has('types')).toBe(false);
    expect(params.has('q')).toBe(false);
  });

  it('rounds coordinates to keep the URL short', () => {
    const params = serializeState({ ...DEFAULT_STATE, lat: 41.123456789 });
    expect(params.get('lat')).toBe('41.12346');
  });
});

describe('parseState', () => {
  it('returns the defaults for an empty URL', () => {
    expect(parseState(new URLSearchParams())).toEqual(DEFAULT_STATE);
  });

  it('replaces invalid or out-of-range numbers by the defaults', () => {
    const state = parseState(new URLSearchParams({ z: 'abc', lat: '95', lon: '2.5' }));
    expect(state.zoom).toBe(DEFAULT_STATE.zoom);
    expect(state.lat).toBe(DEFAULT_STATE.lat);
    expect(state.lon).toBe(2.5);
  });

  it('ignores unknown facility types', () => {
    expect(parseState(new URLSearchParams({ types: 'school,hospital' })).types).toEqual(['school']);
  });

  it('accepts an explicit empty list of types', () => {
    expect(parseState(new URLSearchParams({ types: '' })).types).toEqual([]);
  });
});
