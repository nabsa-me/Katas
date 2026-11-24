import { createHmac } from 'node:crypto';
import { safeEqual } from '../../lib/timing-safe';

/**
 * Verifies `X-Hub-Signature-256`: `sha256=` followed by the hex HMAC-SHA256 of the raw body, keyed with the
 * webhook secret. Compared in constant time. Same check as `verify(secret, payload, signature)` from
 * `@octokit/webhooks-methods`, written by hand to show the mechanism.
 *
 * The signature covers only the body (no timestamp, unlike Slack or Stripe), so a captured delivery stays valid
 * forever: replays are stopped by remembering delivery ids, which the handler does anyway for idempotency.
 */
export function verifyGithubSignature(
  secret: string,
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
): boolean {
  // The legacy `X-Hub-Signature` (SHA-1) is not accepted: only the SHA-256 header and its prefix.
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  return safeEqual(expected, signatureHeader);
}
