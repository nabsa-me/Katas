import { describe, expect, it } from 'vitest';
import { verifySlackSignature, type SlackSignatureInput } from './verify-slack-signature';

// The worked example from Slack's "Verifying requests from Slack" page: secret, timestamp, body and signature.
const OFFICIAL: SlackSignatureInput = {
  signingSecret: '8f742231b10e8888abcd99yyyzzz85a5',
  timestampHeader: '1531420618',
  signatureHeader: 'v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503',
  rawBody:
    'token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c',
  now: 1531420618 * 1000 + 30_000, // 30 seconds after Slack sent it
};

describe('verifySlackSignature', () => {
  it("accepts Slack's documented example", () => {
    expect(verifySlackSignature(OFFICIAL)).toEqual({ ok: true });
  });

  it('accepts the same bytes as a Buffer, as read from the request', () => {
    expect(verifySlackSignature({ ...OFFICIAL, rawBody: Buffer.from(OFFICIAL.rawBody) })).toEqual({ ok: true });
  });

  it('rejects a signature made with another secret', () => {
    expect(verifySlackSignature({ ...OFFICIAL, signingSecret: 'replace-with-another-secret' })).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
  });

  it('rejects a body changed after signing, even the same fields serialized again in another order', () => {
    const reserialized = new URLSearchParams([...new URLSearchParams(String(OFFICIAL.rawBody))].sort()).toString();
    expect(Object.fromEntries(new URLSearchParams(reserialized))).toEqual(
      Object.fromEntries(new URLSearchParams(String(OFFICIAL.rawBody))),
    );
    expect(verifySlackSignature({ ...OFFICIAL, rawBody: reserialized })).toMatchObject({ ok: false });
    expect(verifySlackSignature({ ...OFFICIAL, rawBody: `${OFFICIAL.rawBody}&text=admin` })).toMatchObject({
      ok: false,
    });
  });

  it('rejects a timestamp more than five minutes old, which is how replays are stopped', () => {
    const sixMinutesLater = 1531420618 * 1000 + 6 * 60_000;
    expect(verifySlackSignature({ ...OFFICIAL, now: sixMinutesLater })).toEqual({
      ok: false,
      reason: 'stale-timestamp',
    });
  });

  it('rejects a timestamp too far in the future as well', () => {
    const sixMinutesBefore = 1531420618 * 1000 - 6 * 60_000;
    expect(verifySlackSignature({ ...OFFICIAL, now: sixMinutesBefore })).toMatchObject({ reason: 'stale-timestamp' });
  });

  it('rejects missing headers and a timestamp that is not a number', () => {
    expect(verifySlackSignature({ ...OFFICIAL, signatureHeader: undefined })).toMatchObject({
      reason: 'missing-headers',
    });
    expect(verifySlackSignature({ ...OFFICIAL, timestampHeader: '' })).toMatchObject({ reason: 'missing-headers' });
    expect(verifySlackSignature({ ...OFFICIAL, timestampHeader: '1531420618.5' })).toMatchObject({
      reason: 'invalid-timestamp',
    });
  });

  it('rejects a truncated signature without throwing', () => {
    expect(verifySlackSignature({ ...OFFICIAL, signatureHeader: 'v0=a2114d57' })).toMatchObject({
      reason: 'bad-signature',
    });
  });
});
