import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { z } from 'zod';
import { BodyTooLargeError, readRawBody } from '../../lib/raw-body';
import type { Clock } from '../../lib/time';
import { ephemeral, type SlackMessage } from './report-message';
import { verifySlackSignature } from './verify-slack-signature';

/**
 * The fields of a slash command this app uses (Slack sends more). `response_url` must be a Slack hooks URL: the
 * worker will POST to it, so it is pinned to Slack's host instead of trusting any URL found in a request body.
 */
const slashCommandSchema = z.object({
  command: z.string().startsWith('/'),
  text: z.string(),
  user_id: z.string().min(1),
  channel_id: z.string().min(1),
  response_url: z.url({ protocol: /^https$/, hostname: /^hooks\.slack\.com$/ }),
});

const PROJECT_KEY = /^[A-Z][A-Z0-9_]{1,9}$/;

/** What the worker needs to build the report and answer later. */
export interface SlashCommandJob {
  projectKey: string;
  userId: string;
  channelId: string;
  responseUrl: string;
}

export interface SlashCommandHandlerOptions {
  signingSecret: string;
  /** Hands the job to whatever runs it after the response (an in-memory runner here, SQS in production). */
  enqueue: (job: SlashCommandJob) => void;
  now?: Clock;
  onError?: (error: unknown) => void;
}

/**
 * `/open-issues PLAT`: verifies the request, validates it, enqueues the slow work and acknowledges at once.
 * Slack waits 3 seconds for this response; everything slow happens after it, in the worker.
 */
export function createSlashCommandHandler({
  signingSecret,
  enqueue,
  now = Date.now,
  onError = () => {},
}: SlashCommandHandlerOptions): RequestListener {
  return async (req, res) => {
    try {
      if (req.method !== 'POST') return send(res, 405, ephemeral('Method not allowed'));

      // 1. Raw bytes first: the signature is computed over them, so nothing may parse the body before.
      const rawBody = await readRawBody(req);
      const check = verifySlackSignature({
        signingSecret,
        timestampHeader: header(req, 'x-slack-request-timestamp'),
        signatureHeader: header(req, 'x-slack-signature'),
        rawBody,
        now: now(),
      });
      if (!check.ok) return send(res, 401, ephemeral(`Invalid request: ${check.reason}`));

      // 2. Only now parse and validate: authentic does not mean well-formed.
      const form = slashCommandSchema.safeParse(Object.fromEntries(new URLSearchParams(rawBody.toString('utf8'))));
      if (!form.success) return send(res, 400, ephemeral('Invalid slash command payload'));
      const { command, text, user_id, channel_id, response_url } = form.data;

      const projectKey = text.trim().toUpperCase();
      if (!PROJECT_KEY.test(projectKey)) {
        return send(res, 200, ephemeral(`Usage: ${command} PROJECT_KEY, for example ${command} PLAT`));
      }

      // 3. Hand off the slow part and answer: this is the acknowledgement Slack is waiting for.
      enqueue({ projectKey, userId: user_id, channelId: channel_id, responseUrl: response_url });
      return send(res, 200, ephemeral(`Building the open issues report for ${projectKey}…`));
    } catch (error) {
      if (error instanceof BodyTooLargeError) return send(res, 413, ephemeral('Request too large'));
      onError(error);
      return send(res, 500, ephemeral('Something went wrong'));
    }
  };
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function send(res: ServerResponse, status: number, message: SlackMessage): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(message));
}
