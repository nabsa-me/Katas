/** The application's own roles. The identity provider knows groups; the app decides what they mean. */
export type Role = 'admin' | 'reader';

/**
 * Explicit mapping from identity-provider groups to roles. Anything not listed grants nothing, so a new
 * group in the directory never widens access by accident.
 */
const ROLE_BY_GROUP: Readonly<Record<string, Role>> = {
  'katas-admins': 'admin',
  'katas-readers': 'reader',
};

/**
 * Maps the `groups` claim to roles. The claim comes from a token, so it is external data: anything that is
 * not an array of strings yields no roles, unknown groups are ignored and duplicates are removed.
 */
export function rolesFromGroups(groups: unknown): Role[] {
  if (!Array.isArray(groups)) return [];
  const roles = new Set<Role>();
  for (const group of groups) {
    if (typeof group !== 'string') continue;
    const role = Object.hasOwn(ROLE_BY_GROUP, group) ? ROLE_BY_GROUP[group] : undefined;
    if (role) roles.add(role);
  }
  return [...roles];
}

/** Narrows an unknown value (for example, one read back from a session token) to a known role. */
export function isRole(value: unknown): value is Role {
  return value === 'admin' || value === 'reader';
}
