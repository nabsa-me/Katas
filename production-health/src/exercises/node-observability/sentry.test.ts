import * as Sentry from '@sentry/node';
import { describe, expect, it } from 'vitest';
import { reportToSentry, sentryOptions } from './sentry';

describe('Sentry', () => {
  it('is not initialised without a DSN, and reporting is then a no-op', () => {
    expect(sentryOptions({ sentry: undefined })).toBeUndefined();
    expect(Sentry.getClient()).toBeUndefined();
    expect(() => reportToSentry(new Error('boom'), 'request-h')).not.toThrow();
  });

  it('collects as little personal data as possible when it is enabled', () => {
    const options = sentryOptions({
      sentry: { dsn: 'https://replace_with_public_key@o0.ingest.example.com/0', environment: 'staging' },
    });
    expect(options).toMatchObject({
      environment: 'staging',
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpBodies: [],
        databaseQueryData: false,
        stackFrameVariables: false,
        httpHeaders: { request: { allow: ['user-agent', 'x-correlation-id'] }, response: false },
      },
    });
  });
});
