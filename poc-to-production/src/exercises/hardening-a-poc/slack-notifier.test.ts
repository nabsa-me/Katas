import { delay } from 'msw';
import { http, HttpResponse } from 'msw/http';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createFakeApis, FAKE_CREDENTIALS, SLACK_API_URL, type FakeApiOptions } from '../../lib/fake-apis';
import { UpstreamError } from './errors';
import { DEFAULT_RETRY_POLICY } from './retry';
import { SlackNotifier } from './slack-notifier';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const message = { text: '*Open issues in PLAT on 2026-11-24*: none. Nothing to review today.' };

function setup(fakeOptions: FakeApiOptions = {}, timeoutMs = 1_000) {
  const fakes = createFakeApis(fakeOptions);
  server.use(...fakes.handlers);
  const delays: number[] = [];
  const notifier = new SlackNotifier({
    botToken: FAKE_CREDENTIALS.slackBotToken,
    channelId: 'C0123456789',
    timeoutMs,
    retry: { policy: DEFAULT_RETRY_POLICY, sleep: async (ms) => void delays.push(ms), random: () => 0.5 },
  });
  return { fakes, delays, notifier };
}

async function failure(promise: Promise<unknown>) {
  return promise.then(
    () => expect.fail('expected the post to fail'),
    (error: unknown) => error,
  );
}

describe('SlackNotifier against a fake Slack', () => {
  it('posts the text to the channel with the bot token and returns the message ts', async () => {
    const { fakes, notifier } = setup();
    await expect(notifier.post(message)).resolves.toEqual({ messageId: '1764000000.000001' });
    expect(fakes.slackRequests).toEqual([
      {
        authorization: `Bearer ${FAKE_CREDENTIALS.slackBotToken}`,
        body: { channel: 'C0123456789', text: message.text, unfurl_links: false, unfurl_media: false },
      },
    ]);
  });

  it('turns ok: false over HTTP 200 into a typed error, and does not retry it', async () => {
    const { fakes, notifier } = setup({ slackFailures: ['channel_not_found'] });
    const error = await failure(notifier.post(message));
    expect(error).toBeInstanceOf(UpstreamError);
    expect(error).toMatchObject({ service: 'slack', code: 'channel_not_found', retryable: false });
    expect(fakes.slackRequests).toHaveLength(1);
  });

  it('retries a 429 after Retry-After: Slack rejected the request, so nothing was posted', async () => {
    const { fakes, delays, notifier } = setup({ slackFailures: [429], retryAfterSeconds: 3 });
    await notifier.post(message);
    expect(delays).toEqual([3_000]);
    expect(fakes.slackRequests).toHaveLength(2);
    expect(fakes.slackPosts).toHaveLength(1);
  });

  it('does not retry a 503: the message may have been posted, and a duplicate digest is worse', async () => {
    const { fakes, notifier } = setup({ slackFailures: [503] });
    expect(await failure(notifier.post(message))).toMatchObject({ status: 503, retryable: false });
    expect(fakes.slackRequests).toHaveLength(1);
  });

  it('does not retry a timeout either, for the same reason', async () => {
    const { notifier } = setup({}, 50);
    let calls = 0;
    server.use(
      http.post(`${SLACK_API_URL}/chat.postMessage`, async () => {
        calls++;
        await delay(1_000);
        return HttpResponse.json({ ok: true, channel: 'C0123456789', ts: '1.0' });
      }),
    );
    expect(await failure(notifier.post(message))).toMatchObject({ code: 'timeout', retryable: false });
    expect(calls).toBe(1);
  });
});
