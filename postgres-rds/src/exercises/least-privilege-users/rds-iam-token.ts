import { Signer, type SignerConfig } from '@aws-sdk/rds-signer';
import type { PoolConfig } from 'pg';

export interface IamDatabase {
  hostname: string;
  port: number;
  region: string;
  username: string;
  database: string;
}

/**
 * Signs RDS IAM authentication tokens locally: a token is a presigned URL for the `rds-db:connect`
 * action, so creating one needs AWS credentials but no network call. Without `credentials`, the SDK's
 * default chain is used (the Lambda or ECS task role in production).
 */
export function createIamSigner(database: IamDatabase, credentials?: SignerConfig['credentials']): Signer {
  const { hostname, port, region, username } = database;
  return new Signer({ hostname, port, region, username, credentials });
}

/**
 * Pool settings that authenticate with IAM instead of a stored password. pg calls `password` for every new
 * connection, so each connection gets a fresh token (valid 15 minutes, and only needed to open it).
 * IAM authentication requires TLS; `ca` is the RDS certificate bundle for the region.
 */
export function iamPoolConfig(database: IamDatabase, signer: Signer, ca: string): PoolConfig {
  return {
    host: database.hostname,
    port: database.port,
    user: database.username,
    database: database.database,
    password: () => signer.getAuthToken(),
    ssl: { rejectUnauthorized: true, ca },
  };
}
