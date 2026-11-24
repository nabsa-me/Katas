export class BodyTooLargeError extends Error {
  readonly maxBytes: number;

  constructor(maxBytes: number) {
    super(`Request body is larger than ${maxBytes} bytes`);
    this.name = 'BodyTooLargeError';
    this.maxBytes = maxBytes;
  }
}

/** 1 MB: well above a slash command or a pull request webhook, low enough to stop abuse of a public endpoint. */
export const DEFAULT_MAX_BODY_BYTES = 1_000_000;

/**
 * Reads a request body as the exact bytes received. Webhook signatures (Slack, GitHub, Stripe…) are computed over
 * these bytes, so they must be verified before any parsing: `JSON.parse` + `JSON.stringify` or re-encoding a form
 * changes spacing, key order or escaping, and the signature no longer matches.
 *
 * An `IncomingMessage` is an async iterable of `Buffer` chunks. Reading stops at `maxBytes`: the endpoint is public,
 * and an unauthenticated caller must not be able to make the server buffer an unbounded body.
 */
export async function readRawBody(
  body: AsyncIterable<Buffer | string>,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
    size += buffer.length;
    if (size > maxBytes) throw new BodyTooLargeError(maxBytes);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}
