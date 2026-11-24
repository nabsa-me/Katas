import { describe, expect, it } from 'vitest';
import { decideAccess, hasRole } from './guard';
import type { SessionUser } from './session';

const ada: SessionUser = { sub: 'ada', name: 'Ada Lovelace', roles: ['admin'] };
const grace: SessionUser = { sub: 'grace', name: 'Grace Hopper', roles: ['reader'] };

describe('decideAccess', () => {
  it('sends an anonymous visitor of a page to log in, remembering where they were going', () => {
    expect(decideAccess({ pathname: '/admin', search: '?tab=users' }, null, 'admin')).toEqual({
      type: 'login',
      location: '/api/auth/login?returnTo=%2Fadmin%3Ftab%3Dusers',
    });
  });

  it('answers 401 to an anonymous API call instead of redirecting it to a login page', () => {
    expect(decideAccess({ pathname: '/api/admin/report', search: '' }, null, 'admin')).toEqual({
      type: 'deny',
      status: 401,
      body: 'json',
    });
  });

  it('answers 403 to a signed-in user without the role, as a page or as JSON', () => {
    expect(decideAccess({ pathname: '/admin', search: '' }, grace, 'admin')).toEqual({
      type: 'deny',
      status: 403,
      body: 'page',
    });
    expect(decideAccess({ pathname: '/api/admin/report', search: '' }, grace, 'admin')).toEqual({
      type: 'deny',
      status: 403,
      body: 'json',
    });
  });

  it('lets a user with the role through', () => {
    expect(decideAccess({ pathname: '/admin', search: '' }, ada, 'admin')).toEqual({ type: 'allow' });
    expect(decideAccess({ pathname: '/api/admin/report', search: '' }, ada, 'admin')).toEqual({ type: 'allow' });
  });
});

describe('hasRole', () => {
  it('is false without a user', () => {
    expect(hasRole(null, 'reader')).toBe(false);
    expect(hasRole(grace, 'reader')).toBe(true);
    expect(hasRole(grace, 'admin')).toBe(false);
  });
});
