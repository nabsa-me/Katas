import { describe, expect, it } from 'vitest';
import { matchRoute } from './routes';

describe('matchRoute', () => {
  it.each([
    ['/healthz', { route: '/healthz', params: {} }],
    ['/readyz', { route: '/readyz', params: {} }],
    ['/issues', { route: '/issues', params: {} }],
    ['/issues/PLAT-42', { route: '/issues/:key', params: { key: 'PLAT-42' } }],
    ['/issues/PLAT-42%27', { route: '/issues/:key', params: { key: 'PLAT-42%27' } }],
  ])('matches %s to its template', (path, expected) => {
    expect(matchRoute(path)).toEqual(expected);
  });

  it.each(['/', '/issues/', '/issues/PLAT-42/comments', '/healthz/extra', '/.env'])(
    'matches nothing for %s',
    (path) => {
      expect(matchRoute(path)).toBeUndefined();
    },
  );
});
