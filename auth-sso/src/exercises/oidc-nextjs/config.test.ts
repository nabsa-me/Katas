import { describe, expect, it } from 'vitest';
import { ConfigError, parseConfig } from './config';

const valid = {
  OIDC_ISSUER: 'http://localhost:5806/katas',
  OIDC_CLIENT_ID: 'katas-web',
  APP_URL: 'http://localhost:5804',
  SESSION_SECRET: 'a-test-secret-that-is-long-enough-123',
};

function problemsOf(env: Record<string, string | undefined>): string[] {
  try {
    parseConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  return [];
}

describe('parseConfig', () => {
  it('returns typed values for a valid environment', () => {
    const config = parseConfig(valid);
    expect(config.issuer.href).toBe('http://localhost:5806/katas');
    expect(config.appUrl.origin).toBe('http://localhost:5804');
    expect(config.clientId).toBe('katas-web');
    expect(new TextDecoder().decode(config.sessionSecret)).toBe(valid.SESSION_SECRET);
  });

  it('lists every missing variable at once', () => {
    expect(problemsOf({})).toEqual([
      'OIDC_ISSUER is missing',
      'APP_URL is missing',
      'OIDC_CLIENT_ID is missing',
      'SESSION_SECRET is missing',
    ]);
  });

  it('rejects a short secret and the placeholder from .env.example', () => {
    expect(problemsOf({ ...valid, SESSION_SECRET: 'too-short' })).toEqual([
      'SESSION_SECRET must be at least 32 characters',
    ]);
    expect(problemsOf({ ...valid, SESSION_SECRET: 'replace-with-a-random-secret-of-at-least-32-characters' })).toEqual([
      'SESSION_SECRET still has the placeholder from .env.example',
    ]);
  });

  it('accepts plain http only for an issuer on localhost', () => {
    expect(problemsOf({ ...valid, OIDC_ISSUER: 'http://idp.example.com/realms/katas' })).toEqual([
      'OIDC_ISSUER must use https (http is only accepted for localhost)',
    ]);
    expect(problemsOf({ ...valid, OIDC_ISSUER: 'https://idp.example.com/realms/katas' })).toEqual([]);
  });

  it('reports values that are not http or https URLs', () => {
    expect(problemsOf({ ...valid, APP_URL: 'not a url' })).toEqual(['APP_URL must be an http or https URL']);
    expect(problemsOf({ ...valid, APP_URL: 'localhost:5804' })).toEqual(['APP_URL must be an http or https URL']);
  });
});
