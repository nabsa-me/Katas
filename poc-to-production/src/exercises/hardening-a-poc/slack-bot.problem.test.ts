import { setupServer } from 'msw/node';
import { format } from 'node:util';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createFakeApis, sampleIssues, type FakeApiOptions } from '../../lib/fake-apis';

// The PoC has no tests of its own. These characterization tests run it as it is and pin down what goes wrong.

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

// The placeholders hardcoded in `slack-bot.problem.ts`: the fakes only answer requests that carry them.
const pocCredentials = {
  jiraEmail: 'digest-bot@example.com',
  jiraApiToken: 'replace-with-a-jira-api-token',
  slackBotToken: 'replace-with-a-slack-bot-token',
};

/** The PoC does its work at import time: a fresh import runs it once more. */
async function runPoc(options: FakeApiOptions = {}) {
  const fakes = createFakeApis({ credentials: pocCredentials, ...options });
  server.use(...fakes.handlers);
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.resetModules();
  const error = await import('./slack-bot.problem').then(
    () => undefined,
    (caught: unknown) => caught,
  );
  // What console.log would have printed.
  const output = log.mock.calls.map((args) => format(...args)).join('\n');
  return { fakes, output, error };
}

describe('the PoC, run against fake Jira and Slack', () => {
  it('posts only the first page: 5 of the 12 open issues', async () => {
    const { fakes, error } = await runPoc();
    expect(error).toBeUndefined();
    expect(fakes.jiraRequests).toHaveLength(1);
    const text = fakes.slackPosts[0]?.text ?? '';
    expect(sampleIssues.filter((issue) => text.includes(issue.key))).toHaveLength(5);
    expect(text).not.toContain('PLAT-112');
  });

  it('prints the Jira credentials to the logs', async () => {
    const { output } = await runPoc();
    const printed = /Basic ([A-Za-z0-9+/=]+)/.exec(output)?.[1] ?? '';
    expect(Buffer.from(printed, 'base64').toString()).toBe('digest-bot@example.com:replace-with-a-jira-api-token');
  });

  it('sends `<!channel>`, `<` and `&` from Jira to Slack unescaped', async () => {
    const { fakes } = await runPoc();
    const text = fakes.slackPosts[0]?.text ?? '';
    expect(text).toContain('pinging <!channel>');
    expect(text).toContain('contains < or &');
  });

  it('crashes with a TypeError on a 429 and never retries', async () => {
    const { fakes, error } = await runPoc({ jiraFailures: [429] });
    expect(error).toMatchObject({ name: 'TypeError', message: expect.stringMatching(/not iterable/) });
    expect(fakes.jiraRequests).toHaveLength(1);
    expect(fakes.slackRequests).toHaveLength(0);
  });

  it('crashes with a TypeError on an unassigned issue', async () => {
    const unassignedFirst = [...sampleIssues].reverse();
    const { error } = await runPoc({ issues: unassignedFirst });
    expect(error).toMatchObject({ name: 'TypeError', message: expect.stringMatching(/displayName/) });
  });

  it('reports success when Slack rejects the message with ok: false over HTTP 200', async () => {
    const { fakes, output, error } = await runPoc({ slackFailures: ['channel_not_found'] });
    expect(error).toBeUndefined();
    expect(fakes.slackPosts).toHaveLength(0);
    expect(output).toMatch(/Posted! \{ ok: false, error: 'channel_not_found' \}/);
  });
});
