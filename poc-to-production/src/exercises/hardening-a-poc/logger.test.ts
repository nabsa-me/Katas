import { describe, expect, it } from 'vitest';
import { UpstreamError } from './errors';
import { createLogger } from './logger';

function capture() {
  const lines: Array<Record<string, unknown>> = [];
  return { lines, destination: { write: (line: string) => void lines.push(JSON.parse(line)) } };
}

describe('createLogger', () => {
  it('writes one JSON object per line with the level as a word, an ISO time and the service', () => {
    const { lines, destination } = capture();
    createLogger('info', destination).child({ runId: 'run-1' }).info({ issueCount: 3 }, 'daily digest posted');
    expect(lines).toEqual([
      {
        level: 'info',
        time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
        service: 'jira-slack-digest',
        runId: 'run-1',
        issueCount: 3,
        msg: 'daily digest posted',
      },
    ]);
  });

  it('drops lines below the configured level', () => {
    const { lines, destination } = capture();
    const logger = createLogger('warn', destination);
    logger.info('not written');
    logger.warn('written');
    expect(lines.map((line) => line.msg)).toEqual(['written']);
  });

  it('censors headers and tokens if someone logs them by mistake', () => {
    const { lines, destination } = capture();
    createLogger('info', destination).info(
      {
        headers: { Authorization: 'Basic c2VjcmV0' },
        request: { headers: { authorization: 'Bearer secret' } },
        config: { jira: { apiToken: 'secret' }, slack: { botToken: 'secret' } },
      },
      'oops',
    );
    expect(JSON.stringify(lines)).not.toMatch(/secret|c2VjcmV0/);
    expect(lines[0]).toMatchObject({ headers: { Authorization: '[redacted]' } });
  });

  it('serializes typed errors with their fields and the message of their cause', () => {
    const { lines, destination } = capture();
    const error = new UpstreamError({
      service: 'jira',
      operation: 'search issues',
      code: 'network',
      retryable: true,
      cause: new Error('getaddrinfo ENOTFOUND example.atlassian.net'),
    });
    createLogger('info', destination).error({ err: error }, 'jira search issues failed');
    expect(lines[0]?.err).toMatchObject({
      type: 'UpstreamError',
      message: 'jira search issues failed: network: getaddrinfo ENOTFOUND example.atlassian.net',
      service: 'jira',
      code: 'network',
      retryable: true,
    });
  });
});
