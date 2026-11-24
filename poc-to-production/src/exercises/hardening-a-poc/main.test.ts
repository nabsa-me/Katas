import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createFakeApis, FAKE_CREDENTIALS, FAKE_JIRA_BASE_URL, type FakeApiOptions } from '../../lib/fake-apis';
import { EXIT_CODES, main } from './main';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const env = {
  JIRA_BASE_URL: FAKE_JIRA_BASE_URL,
  JIRA_EMAIL: FAKE_CREDENTIALS.jiraEmail,
  JIRA_API_TOKEN: FAKE_CREDENTIALS.jiraApiToken,
  JIRA_PROJECT_KEY: 'PLAT',
  SLACK_BOT_TOKEN: FAKE_CREDENTIALS.slackBotToken,
  SLACK_CHANNEL_ID: 'C0123456789',
};

/** Runs the whole bot against the fakes, with instant sleeps and the log lines collected. */
async function run(fakeOptions: FakeApiOptions = {}, environment: Record<string, string | undefined> = env) {
  const fakes = createFakeApis(fakeOptions);
  server.use(...fakes.handlers);
  const raw: string[] = [];
  const exitCode = await main({
    env: environment,
    now: () => new Date('2026-11-24T07:00:00Z'),
    sleep: async () => {},
    random: () => 0.5,
    logDestination: { write: (line) => void raw.push(line) },
  });
  const logs = raw.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { exitCode, fakes, raw: raw.join(''), logs };
}

describe('the hardened bot, end to end against fake Jira and Slack', () => {
  it('posts one digest with every open issue and exits with 0', async () => {
    const { exitCode, fakes, logs } = await run();
    expect(exitCode).toBe(EXIT_CODES.ok);
    expect(fakes.jiraRequests).toHaveLength(3);
    expect(fakes.slackPosts).toHaveLength(1);
    const text = fakes.slackPosts[0]?.text ?? '';
    expect(text).toMatch(/^\*Open issues in PLAT on 2026-11-24\*: 12/);
    expect(text).toContain('PLAT-112');
    expect(text).toContain('&lt;!channel&gt;');
    expect(text).not.toContain('<!channel>');
    expect(logs.at(-1)).toMatchObject({ level: 'info', msg: 'daily digest posted', issueCount: 12 });
  });

  it('logs JSON lines that share a run id and never contain a credential', async () => {
    const { raw, logs } = await run({ jiraFailures: [429] });
    const runIds = new Set(logs.map((line) => line.runId));
    expect(runIds.size).toBe(1);
    expect([...runIds][0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(logs.map((line) => line.msg)).toEqual([
      'daily digest started',
      'transient error, retrying',
      'daily digest posted',
    ]);
    const basic = Buffer.from(`${FAKE_CREDENTIALS.jiraEmail}:${FAKE_CREDENTIALS.jiraApiToken}`).toString('base64');
    for (const secret of [FAKE_CREDENTIALS.jiraApiToken, FAKE_CREDENTIALS.slackBotToken, basic]) {
      expect(raw).not.toContain(secret);
    }
  });

  it('exits with 2 and lists every problem when the configuration is incomplete, without calling anything', async () => {
    const { exitCode, fakes, logs } = await run({}, { ...env, JIRA_API_TOKEN: '', SLACK_CHANNEL_ID: undefined });
    expect(exitCode).toBe(EXIT_CODES.config);
    expect(logs).toEqual([
      expect.objectContaining({
        level: 'fatal',
        problems: ['JIRA_API_TOKEN is missing', 'SLACK_CHANNEL_ID is missing'],
      }),
    ]);
    expect(fakes.jiraRequests).toHaveLength(0);
  });

  it('exits with 3 and logs the typed error when Slack rejects the message', async () => {
    const { exitCode, logs } = await run({ slackFailures: ['not_in_channel'] });
    expect(exitCode).toBe(EXIT_CODES.upstream);
    expect(logs.at(-1)).toMatchObject({
      level: 'error',
      msg: 'slack chat.postMessage failed, the digest was not posted',
      err: { type: 'UpstreamError', service: 'slack', code: 'not_in_channel', retryable: false },
    });
  });

  it('exits with 3 and posts nothing when Jira is still failing after the retries', async () => {
    const { exitCode, fakes, logs } = await run({ jiraFailures: [503, 503, 503, 503] });
    expect(exitCode).toBe(EXIT_CODES.upstream);
    expect(fakes.slackRequests).toHaveLength(0);
    expect(logs.filter((line) => line.msg === 'transient error, retrying')).toHaveLength(3);
  });
});
