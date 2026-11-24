import { describe, expect, it } from 'vitest';
import { DEFAULT_RETURN_TO, safeReturnTo } from './return-to';

describe('safeReturnTo', () => {
  it('keeps a path on this app, with its query string', () => {
    expect(safeReturnTo('/admin')).toBe('/admin');
    expect(safeReturnTo('/admin/users?page=2#top')).toBe('/admin/users?page=2#top');
  });

  it('rejects absolute URLs to other sites', () => {
    expect(safeReturnTo('https://evil.example/phish')).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo('javascript:alert(1)')).toBe(DEFAULT_RETURN_TO);
  });

  it('rejects protocol-relative URLs, including the backslash variant browsers normalize', () => {
    expect(safeReturnTo('//evil.example')).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo('/\\evil.example')).toBe(DEFAULT_RETURN_TO);
  });

  it('falls back when the value is missing or relative to the current page', () => {
    expect(safeReturnTo(null)).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo('')).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo('admin')).toBe(DEFAULT_RETURN_TO);
  });
});
