import { describe, expect, it } from 'vitest';
import { allRoutes, exercises, type Exercise } from './exercises';

describe('exercise routes', () => {
  it('are absolute, unique paths', () => {
    const hrefs = allRoutes().map((route) => route.href);
    expect(hrefs.every((href) => href.startsWith('/'))).toBe(true);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('every exercise has at least one problem and one solution', () => {
    for (const exercise of exercises) {
      const kinds = new Set(exercise.routes.map((route) => route.kind));
      expect(kinds).toEqual(new Set(['problem', 'solution']));
    }
  });

  it('allRoutes flattens the routes in order', () => {
    const list: Exercise[] = [
      { title: 'A', folder: 'a', routes: [{ label: 'x', href: '/a/x', kind: 'problem' }] },
      { title: 'B', folder: 'b', routes: [{ label: 'y', href: '/b/y', kind: 'solution' }] },
    ];
    expect(allRoutes(list).map((route) => route.href)).toEqual(['/a/x', '/b/y']);
  });
});
