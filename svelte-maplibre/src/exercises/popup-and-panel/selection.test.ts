import { describe, expect, it } from 'vitest';
import { selectionChange } from './selection';

describe('selectionChange', () => {
  it('selects a feature when nothing was selected', () => {
    expect(selectionChange(null, 4)).toEqual({ clear: null, set: 4 });
  });

  it('moves the selection from one feature to another', () => {
    expect(selectionChange(4, 7)).toEqual({ clear: 4, set: 7 });
  });

  it('clears the selection', () => {
    expect(selectionChange(7, null)).toEqual({ clear: 7, set: null });
  });

  it('does nothing when the same feature is selected again', () => {
    expect(selectionChange(7, 7)).toEqual({ clear: null, set: null });
  });
});
