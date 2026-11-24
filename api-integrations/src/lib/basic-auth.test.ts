import { describe, expect, it } from 'vitest';
import { basicAuth } from './basic-auth';

describe('basicAuth', () => {
  it('encodes user:secret in base64 after the Basic scheme', () => {
    expect(basicAuth('Aladdin', 'open sesame')).toBe('Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==');
  });

  it('uses UTF-8, so non-ASCII characters survive the round trip', () => {
    const header = basicAuth('núria@example.com', 'replace-with-an-api-token');
    const decoded = Buffer.from(header.replace('Basic ', ''), 'base64').toString('utf8');
    expect(decoded).toBe('núria@example.com:replace-with-an-api-token');
  });

  it('rejects a user name with a colon, which would make the pair ambiguous', () => {
    expect(() => basicAuth('a:b', 'secret')).toThrow(/cannot contain/);
  });
});
