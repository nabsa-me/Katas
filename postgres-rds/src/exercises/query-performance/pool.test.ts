import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTemporaryDatabase, type TemporaryDatabase } from '../../lib/database';
import { createPool, poolSizePerInstance } from './pool';

describe('poolSizePerInstance', () => {
  it('splits what is left after the reserved connections between every instance', () => {
    expect(poolSizePerInstance({ maxConnections: 400, reservedConnections: 40, instances: 12 })).toBe(30);
  });

  it('halves when a blue/green deploy runs both colours at once', () => {
    expect(poolSizePerInstance({ maxConnections: 400, reservedConnections: 40, instances: 24 })).toBe(15);
  });

  it('refuses a budget that cannot give every instance a connection', () => {
    expect(() => poolSizePerInstance({ maxConnections: 100, reservedConnections: 10, instances: 200 })).toThrow(
      /do not fit/,
    );
    expect(() => poolSizePerInstance({ maxConnections: 100, reservedConnections: -1, instances: 2 })).toThrow(
      /positive whole numbers/,
    );
  });
});

describe('createPool', () => {
  let db: TemporaryDatabase;
  beforeAll(async () => {
    db = await createTemporaryDatabase('pool_settings');
  });
  afterAll(() => db.drop());

  it('applies the size and the session settings the server will enforce', async () => {
    const pool = createPool(db.connectionString, { maxConnections: 100, reservedConnections: 10, instances: 3 });
    try {
      expect(pool.options.max).toBe(30);
      const { rows } = await pool.query(
        `SELECT current_setting('statement_timeout') AS statement_timeout,
                current_setting('application_name') AS application_name`,
      );
      expect(rows).toEqual([{ statement_timeout: '5s', application_name: 'issues-api' }]);
    } finally {
      await pool.end();
    }
  });
});
