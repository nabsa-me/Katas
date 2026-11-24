import { describe, expect, it } from 'vitest';
import { createIamSigner, iamPoolConfig, type IamDatabase } from './rds-iam-token';

const database: IamDatabase = {
  hostname: 'issues-db.abcdefexample.eu-west-1.rds.amazonaws.com',
  port: 5432,
  region: 'eu-west-1',
  username: 'issues_api',
  database: 'issues',
};

// Static fake credentials: signing is local, nothing is sent to AWS.
const fakeCredentials = {
  accessKeyId: 'replace-with-access-key-id',
  secretAccessKey: 'replace-with-secret-access-key',
};

describe('RDS IAM authentication token', () => {
  it('is a presigned rds-db connect request for the user, valid for 15 minutes', async () => {
    const token = await createIamSigner(database, fakeCredentials).getAuthToken();
    const url = new URL(`https://${token}`);

    expect(url.host).toBe(`${database.hostname}:5432`);
    expect(url.searchParams.get('Action')).toBe('connect');
    expect(url.searchParams.get('DBUser')).toBe('issues_api');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.searchParams.get('X-Amz-Credential')).toMatch(
      /^replace-with-access-key-id\/\d{8}\/eu-west-1\/rds-db\/aws4_request$/,
    );
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is used as the password of every new pool connection, over verified TLS', async () => {
    const config = iamPoolConfig(database, createIamSigner(database, fakeCredentials), 'replace-with-rds-ca-bundle');

    expect(config).toMatchObject({ host: database.hostname, port: 5432, user: 'issues_api', database: 'issues' });
    expect(config.ssl).toEqual({ rejectUnauthorized: true, ca: 'replace-with-rds-ca-bundle' });
    expect(typeof config.password).toBe('function');
    const password = typeof config.password === 'function' ? await config.password() : config.password;
    expect(password).toContain('Action=connect&DBUser=issues_api');
  });
});
