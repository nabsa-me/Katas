import { Pool } from 'pg';
import type { Queryable } from '../../lib/database';

/** What the connected user is allowed to do beyond reading and writing rows. */
export interface UserPrivileges {
  user: string;
  superuser: boolean;
  rdsSuperuser: boolean;
  createRole: boolean;
  createDatabase: boolean;
  bypassRowLevelSecurity: boolean;
  ownsTables: boolean;
  canCreateInPublic: boolean;
}

export async function readUserPrivileges(db: Queryable): Promise<UserPrivileges> {
  const { rows } = await db.query<UserPrivileges>(`
    SELECT
      current_user AS "user",
      r.rolsuper AS superuser,
      EXISTS (
        SELECT 1 FROM pg_roles AS s
        WHERE s.rolname = 'rds_superuser' AND pg_has_role(current_user, s.oid, 'MEMBER')
      ) AS "rdsSuperuser",
      r.rolcreaterole AS "createRole",
      r.rolcreatedb AS "createDatabase",
      r.rolbypassrls AS "bypassRowLevelSecurity",
      EXISTS (
        SELECT 1 FROM pg_class AS c
        WHERE c.relnamespace = 'public'::regnamespace AND pg_has_role(current_user, c.relowner, 'USAGE')
      ) AS "ownsTables",
      has_schema_privilege('public', 'CREATE') AS "canCreateInPublic"
    FROM pg_roles AS r
    WHERE r.rolname = current_user`);
  const privileges = rows[0];
  if (!privileges) throw new Error('Could not read the privileges of the current user');
  return privileges;
}

/** Every privilege the application user must not have, as readable reasons. Empty means fine. */
export function excessPrivileges(privileges: UserPrivileges): string[] {
  const reasons: Array<[boolean, string]> = [
    [privileges.superuser, 'is a superuser'],
    [privileges.rdsSuperuser, 'is a member of rds_superuser (the RDS master user is)'],
    [privileges.createRole, 'can create roles'],
    [privileges.createDatabase, 'can create databases'],
    [privileges.bypassRowLevelSecurity, 'bypasses row-level security'],
    [privileges.ownsTables, 'owns tables, so it can alter or drop them'],
    [privileges.canCreateInPublic, 'can create objects in schema public'],
  ];
  return reasons.filter(([applies]) => applies).map(([, reason]) => reason);
}

/**
 * Connects with the application's own user and refuses to start when that user can do more than read and
 * write rows. A misconfigured secret (the master user's, or the migrator's) fails the deploy at startup
 * instead of running in production unnoticed.
 */
export async function createAppPool(connectionString: string): Promise<Pool> {
  const pool = new Pool({ connectionString, application_name: 'issues-api' });
  try {
    const privileges = await readUserPrivileges(pool);
    const excess = excessPrivileges(privileges);
    if (excess.length > 0) {
      throw new Error(`Refusing to start: database user "${privileges.user}" ${excess.join(', ')}`);
    }
    return pool;
  } catch (error) {
    await pool.end();
    throw error;
  }
}
