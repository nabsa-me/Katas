import { timingSafeEqual } from 'node:crypto';

/**
 * Compares two strings in constant time. `a === b` returns at the first different character, so the response time
 * leaks how much of a forged signature is right; `timingSafeEqual` always compares every byte.
 *
 * `timingSafeEqual` throws when the buffers have different lengths, so lengths are checked first. That leaks only
 * the length, which is public anyway: an HMAC-SHA256 hex signature always has 64 characters.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
