import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { BodyTooLargeError, readRawBody } from './raw-body';

describe('readRawBody', () => {
  it('joins the chunks into the exact bytes received', async () => {
    const body = await readRawBody(Readable.from([Buffer.from('{"a": '), Buffer.from('1}')]));
    expect(body.toString('utf8')).toBe('{"a": 1}');
  });

  it('keeps multi-byte characters split across chunks intact', async () => {
    const bytes = Buffer.from('Núria', 'utf8');
    const body = await readRawBody(Readable.from([bytes.subarray(0, 2), bytes.subarray(2)]));
    expect(body.toString('utf8')).toBe('Núria');
  });

  it('returns an empty buffer for an empty body', async () => {
    expect((await readRawBody(Readable.from([]))).length).toBe(0);
  });

  it('stops reading past the limit', async () => {
    const body = Readable.from([Buffer.alloc(6), Buffer.alloc(6)]);
    await expect(readRawBody(body, 10)).rejects.toBeInstanceOf(BodyTooLargeError);
  });
});
