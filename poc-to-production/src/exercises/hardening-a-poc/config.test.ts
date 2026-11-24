import { describe, expect, it } from 'vitest';
import { describeConfig, loadConfig } from './config';
import { ConfigError } from './errors';

const validEnv = {
  JIRA_BASE_URL: 'https://example.atlassian.net/',
  JIRA_EMAIL: 'digest-bot@example.com',
  JIRA_API_TOKEN: 'fake-jira-api-token',
  JIRA_PROJECT_KEY: 'PLAT',
  SLACK_BOT_TOKEN: 'fake-slack-bot-token',
  SLACK_CHANNEL_ID: 'C0123456789',
};

function problemsFor(env: Record<string, string | undefined>): readonly string[] {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  throw new Error('expected a ConfigError');
}

describe('loadConfig', () => {
  it('returns a typed configuration with defaults and without the trailing slash', () => {
    expect(loadConfig(validEnv)).toEqual({
      jira: {
        baseUrl: 'https://example.atlassian.net',
        email: 'digest-bot@example.com',
        apiToken: 'fake-jira-api-token',
        projectKey: 'PLAT',
      },
      slack: { botToken: 'fake-slack-bot-token', channelId: 'C0123456789' },
      requestTimeoutMs: 10_000,
      logLevel: 'info',
    });
  });

  it('lists every missing variable at once, so one run says everything to fix', () => {
    expect(problemsFor({})).toEqual([
      'JIRA_BASE_URL is missing',
      'JIRA_EMAIL is missing',
      'JIRA_API_TOKEN is missing',
      'JIRA_PROJECT_KEY is missing',
      'SLACK_BOT_TOKEN is missing',
      'SLACK_CHANNEL_ID is missing',
    ]);
  });

  it('treats an empty or blank variable as missing', () => {
    expect(problemsFor({ ...validEnv, JIRA_API_TOKEN: '', SLACK_BOT_TOKEN: '   ' })).toEqual([
      'JIRA_API_TOKEN is missing',
      'SLACK_BOT_TOKEN is missing',
    ]);
  });

  it('rejects the placeholders copied from .env.example', () => {
    expect(problemsFor({ ...validEnv, SLACK_BOT_TOKEN: 'replace-with-a-slack-bot-token' })).toEqual([
      'SLACK_BOT_TOKEN still has the placeholder from .env.example',
    ]);
  });

  it('validates formats: https only, a project key that cannot inject JQL, a channel id, numbers', () => {
    const problems = problemsFor({
      ...validEnv,
      JIRA_BASE_URL: 'http://example.atlassian.net',
      JIRA_PROJECT_KEY: 'PLAT OR project = HR',
      SLACK_CHANNEL_ID: '#platform',
      REQUEST_TIMEOUT_MS: 'ten seconds',
      LOG_LEVEL: 'verbose',
    });
    expect(problems).toEqual([
      expect.stringMatching(/^JIRA_BASE_URL must be an https URL/),
      'JIRA_PROJECT_KEY must be a Jira project key such as PLAT',
      'SLACK_CHANNEL_ID must be a channel id such as C0123456789, not a name',
      'REQUEST_TIMEOUT_MS must be a number of milliseconds',
      'LOG_LEVEL must be debug, info, warn or error',
    ]);
  });

  it('never puts a value in the error message', () => {
    const leakedSecret = 'replace-with-a-value-that-must-not-leak';
    const error = (() => {
      try {
        return loadConfig({ ...validEnv, JIRA_BASE_URL: `http://${leakedSecret}`, JIRA_API_TOKEN: leakedSecret });
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(ConfigError);
    expect(String((error as ConfigError).message)).not.toContain(leakedSecret);
  });
});

describe('describeConfig', () => {
  it('keeps everything except the secrets, so it can be logged', () => {
    const summary = JSON.stringify(describeConfig(loadConfig(validEnv)));
    expect(summary).toContain('PLAT');
    expect(summary).not.toContain(validEnv.JIRA_API_TOKEN);
    expect(summary).not.toContain(validEnv.SLACK_BOT_TOKEN);
  });
});
