import { describe, expect, it } from 'vitest';
import { LOCAL_DATABASE_URL } from '../../lib/postgres';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('runs locally with no variables at all, without Sentry', () => {
    expect(loadConfig({})).toEqual({
      port: 5808,
      host: '127.0.0.1',
      databaseUrl: LOCAL_DATABASE_URL,
      logLevel: 'info',
      readinessTimeoutMs: 1_000,
      drainDelayMs: 0,
      sentry: undefined,
    });
  });

  it('enables Sentry only when a DSN is set, and treats an empty one as unset', () => {
    const dsn = 'https://replace_with_public_key@o0.ingest.example.com/0';
    expect(loadConfig({ SENTRY_DSN: dsn, SENTRY_ENVIRONMENT: 'staging' }).sentry).toEqual({
      dsn,
      environment: 'staging',
    });
    expect(loadConfig({ SENTRY_DSN: '' }).sentry).toBeUndefined();
  });

  it('fails listing every problem, naming variables and never their values', () => {
    const secretUrl = 'mysql://app:s3cret-password@db.internal/issues';
    const load = () => loadConfig({ PORT: 'eighty', DATABASE_URL: secretUrl, LOG_LEVEL: 'verbose' });

    expect(load).toThrow(/PORT must be a port number/);
    expect(load).toThrow(/DATABASE_URL must be a postgres:\/\/ URL/);
    expect(load).toThrow(/LOG_LEVEL must be debug, info, warn or error/);
    expect(load).not.toThrow(/s3cret-password/);
  });
});
