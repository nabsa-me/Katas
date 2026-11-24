import { createHmac } from 'node:crypto';
import { safeEqual } from '../../lib/timing-safe';

/** Slack's recommended window: a request older (or newer) than five minutes is rejected as a possible replay. */
export const MAX_REQUEST_AGE_SECONDS = 5 * 60;

export type SignatureFailure = 'missing-headers' | 'invalid-timestamp' | 'stale-timestamp' | 'bad-signature';
export type SignatureCheck = { ok: true } | { ok: false; reason: SignatureFailure };

export interface SlackSignatureInput {
  /** The app's Signing Secret (Basic Information page of the app). Never the bot token. */
  signingSecret: string;
  /** `X-Slack-Request-Timestamp`: Unix seconds when Slack sent the request. */
  timestampHeader: string | undefined;
  /** `X-Slack-Signature`: `v0=` followed by the hex HMAC-SHA256. */
  signatureHeader: string | undefined;
  /** The body exactly as received, before any parsing. */
  rawBody: Buffer | string;
  /** Current time in milliseconds. */
  now: number;
}

/**
 * Verifies that a request comes from Slack and was not replayed:
 * 1. the timestamp is within five minutes of now (a captured request can't be sent again later);
 * 2. HMAC-SHA256 with the signing secret over `v0:{timestamp}:{raw body}`, hex-encoded with a `v0=` prefix,
 *    equals the signature header, compared in constant time.
 * The timestamp is inside the signed string, so an attacker can't refresh it without the secret.
 */
export function verifySlackSignature({
  signingSecret,
  timestampHeader,
  signatureHeader,
  rawBody,
  now,
}: SlackSignatureInput): SignatureCheck {
  if (!timestampHeader || !signatureHeader) return { ok: false, reason: 'missing-headers' };
  if (!/^\d+$/.test(timestampHeader)) return { ok: false, reason: 'invalid-timestamp' };

  const ageSeconds = Math.abs(Math.floor(now / 1000) - Number(timestampHeader));
  if (ageSeconds > MAX_REQUEST_AGE_SECONDS) return { ok: false, reason: 'stale-timestamp' };

  const hmac = createHmac('sha256', signingSecret).update(`v0:${timestampHeader}:`).update(rawBody).digest('hex');
  return safeEqual(`v0=${hmac}`, signatureHeader) ? { ok: true } : { ok: false, reason: 'bad-signature' };
}
