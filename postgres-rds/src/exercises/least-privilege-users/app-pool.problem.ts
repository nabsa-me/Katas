import { Pool } from 'pg';

/**
 * Flawed: the application connects with the master user, the one the database was created with. Whatever
 * the code does (or an injected statement does through it) runs with the power to drop tables, read every
 * schema and create roles. Nothing checks it, so it stays that way after the PoC becomes production.
 */
export function createAppPool(masterConnectionString: string): Pool {
  return new Pool({ connectionString: masterConnectionString });
}
