import { describe, expect, it } from 'vitest';
import { createRenderLog } from './render-log';

describe('createRenderLog', () => {
  it('starts every name at zero', () => {
    expect(createRenderLog().count('Row a')).toBe(0);
  });

  it('counts each name separately and returns the new count', () => {
    const log = createRenderLog();
    expect(log.record('Row a')).toBe(1);
    expect(log.record('Row a')).toBe(2);
    expect(log.record('Row b')).toBe(1);
    expect(log.count('Row a')).toBe(2);
  });

  it('forgets everything on reset', () => {
    const log = createRenderLog();
    log.record('Row a');
    log.reset();
    expect(log.count('Row a')).toBe(0);
  });
});
