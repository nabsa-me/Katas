import { describe, expect, it } from 'vitest';
import { INITIAL_USER, sessionReducer } from './session';

describe('sessionReducer', () => {
  it('renames, trimming the new name', () => {
    expect(sessionReducer(INITIAL_USER, { type: 'rename', name: '  Pau Serra ' })).toEqual({
      ...INITIAL_USER,
      name: 'Pau Serra',
    });
  });

  it('returns the same object when the name does not change, so React can skip the update', () => {
    expect(sessionReducer(INITIAL_USER, { type: 'rename', name: INITIAL_USER.name })).toBe(INITIAL_USER);
    expect(sessionReducer(INITIAL_USER, { type: 'rename', name: '   ' })).toBe(INITIAL_USER);
  });
});
