import { z } from 'zod';
import { UpstreamError } from './errors';
import { postJson } from './http';
import type { ChatMessage, ChatNotifier } from './ports';
import { withRetry, type RetryOptions } from './retry';

const OPERATION = 'chat.postMessage';
const SLACK_API_URL = 'https://slack.com/api';

/** Slack answers almost every error with HTTP 200: the `ok` field is the real status. */
const postMessageSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), channel: z.string(), ts: z.string() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

export interface SlackNotifierOptions {
  botToken: string;
  channelId: string;
  timeoutMs: number;
  retry: RetryOptions;
}

/**
 * Adapter for the `ChatNotifier` port: Slack's `chat.postMessage` with a bot token as a Bearer header.
 * Posting is not idempotent, so only a 429 is retried (Slack rejected the request, nothing was posted).
 * A timeout or a 5xx is not: the message may be in the channel already, and a duplicate digest is worse
 * than a failed run that alerts.
 */
export class SlackNotifier implements ChatNotifier {
  readonly #options: SlackNotifierOptions;

  constructor(options: SlackNotifierOptions) {
    this.#options = options;
  }

  async post(message: ChatMessage): Promise<{ messageId: string }> {
    const { botToken, channelId, timeoutMs, retry } = this.#options;
    const result = await withRetry(
      () =>
        postJson(
          {
            service: 'slack',
            operation: OPERATION,
            url: `${SLACK_API_URL}/${OPERATION}`,
            headers: { Authorization: `Bearer ${botToken}` },
            body: { channel: channelId, text: message.text, unfurl_links: false, unfurl_media: false },
            timeoutMs,
            idempotent: false,
          },
          postMessageSchema,
        ),
      retry,
    );
    if (!result.ok) {
      // `channel_not_found`, `not_in_channel`, `invalid_auth`…: a configuration problem, not a transient one.
      throw new UpstreamError({
        service: 'slack',
        operation: OPERATION,
        status: 200,
        code: result.error,
        retryable: false,
      });
    }
    return { messageId: result.ts };
  }
}
