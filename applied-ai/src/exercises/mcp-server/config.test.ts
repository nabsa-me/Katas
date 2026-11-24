import { describe, expect, it } from 'vitest';
import { ConfigError, loadJiraConfig } from './config';

const VALID = {
  JIRA_BASE_URL: 'https://katas-example.atlassian.net/',
  JIRA_EMAIL: 'ada@example.com',
  JIRA_API_TOKEN: 'replace-with-an-api-token',
};

describe('loadJiraConfig', () => {
  it('reads the site, the account and the token, and drops a trailing slash from the URL', () => {
    expect(loadJiraConfig(VALID)).toEqual({
      baseUrl: 'https://katas-example.atlassian.net',
      email: 'ada@example.com',
      apiToken: 'replace-with-an-api-token',
      timeoutMs: 10_000,
    });
  });

  it('fails at startup listing every missing variable', () => {
    const load = () => loadJiraConfig({});
    expect(load).toThrow(ConfigError);
    expect(load).toThrow(/JIRA_BASE_URL[\s\S]*JIRA_EMAIL[\s\S]*JIRA_API_TOKEN/);
  });

  it('rejects a plain http URL, which would send the token unencrypted', () => {
    expect(() => loadJiraConfig({ ...VALID, JIRA_BASE_URL: 'http://katas-example.atlassian.net' })).toThrow(
      /JIRA_BASE_URL/,
    );
  });

  it('never repeats the token in the error message', () => {
    const load = () => loadJiraConfig({ ...VALID, JIRA_EMAIL: 'not-an-email' });
    expect(load).toThrow(/JIRA_EMAIL/);
    expect(load).not.toThrow(/replace-with-an-api-token/);
  });
});
