import { describe, expect, it } from 'vitest';
import { isRole, rolesFromGroups } from './roles';

describe('rolesFromGroups', () => {
  it('maps each known group to its role', () => {
    expect(rolesFromGroups(['katas-admins'])).toEqual(['admin']);
    expect(rolesFromGroups(['katas-readers'])).toEqual(['reader']);
    expect(rolesFromGroups(['katas-readers', 'katas-admins'])).toEqual(['reader', 'admin']);
  });

  it('ignores unknown groups instead of guessing', () => {
    expect(rolesFromGroups(['katas-admins-old', 'admins', 'admin'])).toEqual([]);
  });

  it('does not treat inherited object keys as groups', () => {
    expect(rolesFromGroups(['constructor', 'toString', '__proto__'])).toEqual([]);
  });

  it('removes duplicates', () => {
    expect(rolesFromGroups(['katas-admins', 'katas-admins'])).toEqual(['admin']);
  });

  it('returns no roles when the claim is missing or is not an array of strings', () => {
    expect(rolesFromGroups(undefined)).toEqual([]);
    expect(rolesFromGroups('katas-admins')).toEqual([]);
    expect(rolesFromGroups({ 0: 'katas-admins' })).toEqual([]);
    expect(rolesFromGroups([42, null, { name: 'katas-admins' }])).toEqual([]);
  });
});

describe('isRole', () => {
  it('accepts only the known roles', () => {
    expect(isRole('admin')).toBe(true);
    expect(isRole('reader')).toBe(true);
    expect(isRole('root')).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
});
