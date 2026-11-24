import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { BodyTooLargeError, readRawBody } from '../../lib/raw-body';
import type { DeliveryStore } from './delivery-store';
import type { WebhookEvent } from './pull-request-opened';
import { verifyGithubSignature } from './verify-github-signature';

export interface WebhookHandlerOptions {
  /** The secret configured on the webhook in GitHub. */
  secret: string;
  store: DeliveryStore;
  /** Does the work for a verified, first-time delivery. Runs after the response. */
  process: (event: WebhookEvent) => Promise<void>;
  /** Runs work after the response (an in-memory runner here, a queue in production). */
  runInBackground: (task: () => Promise<void>) => void;
  onError?: (error: unknown) => void;
}

/**
 * Verifies, deduplicates and acknowledges a GitHub delivery, then processes it in the background:
 * 401 bad signature · 400 malformed · 200 duplicate (already accepted) · 202 accepted.
 * GitHub expects a 2XX within 10 seconds, so the slow part never runs before the response.
 */
export function createWebhookHandler({
  secret,
  store,
  process,
  runInBackground,
  onError = () => {},
}: WebhookHandlerOptions): RequestListener {
  return async (req, res) => {
    try {
      if (req.method !== 'POST') return send(res, 405, 'method not allowed');

      const rawBody = await readRawBody(req);
      if (!verifyGithubSignature(secret, rawBody, header(req, 'x-hub-signature-256'))) {
        return send(res, 401, 'invalid signature');
      }

      const deliveryId = header(req, 'x-github-delivery');
      const name = header(req, 'x-github-event');
      if (!deliveryId || !name) return send(res, 400, 'missing X-GitHub-Delivery or X-GitHub-Event');
      let payload: unknown;
      try {
        payload = JSON.parse(rawBody.toString('utf8'));
      } catch {
        return send(res, 400, 'body is not JSON');
      }

      // A redelivery has the same id: answer 2XX (so GitHub stops retrying) and do nothing.
      if (!(await store.claim(deliveryId))) return send(res, 200, 'duplicate');

      runInBackground(async () => {
        try {
          await process({ name, deliveryId, payload });
        } catch (error) {
          // Forget the id, so that redelivering this delivery from GitHub can process it again.
          await store.release(deliveryId);
          throw error;
        }
      });
      return send(res, 202, 'accepted');
    } catch (error) {
      if (error instanceof BodyTooLargeError) return send(res, 413, 'payload too large');
      onError(error);
      return send(res, 500, 'internal error');
    }
  };
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function send(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ message }));
}
