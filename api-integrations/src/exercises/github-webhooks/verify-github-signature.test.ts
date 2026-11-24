import { describe, expect, it } from 'vitest';
import { verifyGithubSignature } from './verify-github-signature';

// The test values from GitHub's "Validating webhook deliveries" page.
const SECRET = "It's a Secret to Everybody";
const PAYLOAD = 'Hello, World!';
const SIGNATURE = 'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17';

describe('verifyGithubSignature', () => {
  it("accepts GitHub's documented example, as a string or as bytes", () => {
    expect(verifyGithubSignature(SECRET, PAYLOAD, SIGNATURE)).toBe(true);
    expect(verifyGithubSignature(SECRET, Buffer.from(PAYLOAD), SIGNATURE)).toBe(true);
  });

  it('rejects another secret, another body or a missing header', () => {
    expect(verifyGithubSignature('replace-with-another-secret', PAYLOAD, SIGNATURE)).toBe(false);
    expect(verifyGithubSignature(SECRET, 'Hello, World?', SIGNATURE)).toBe(false);
    expect(verifyGithubSignature(SECRET, PAYLOAD, undefined)).toBe(false);
  });

  it('rejects the hex without its prefix and the legacy sha1 prefix', () => {
    expect(verifyGithubSignature(SECRET, PAYLOAD, SIGNATURE.replace('sha256=', ''))).toBe(false);
    expect(verifyGithubSignature(SECRET, PAYLOAD, SIGNATURE.replace('sha256=', 'sha1='))).toBe(false);
  });

  it('rejects a truncated signature without throwing', () => {
    expect(verifyGithubSignature(SECRET, PAYLOAD, 'sha256=757107ea')).toBe(false);
  });
});
