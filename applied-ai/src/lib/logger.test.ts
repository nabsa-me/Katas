import { describe, expect, it } from 'vitest';
import { createLogger, memoryDestination } from './logger';

describe('createLogger', () => {
  it('writes one JSON object per line with the component name, the level as a word and an ISO time', () => {
    const { records, destination } = memoryDestination();
    createLogger({ name: 'bedrock', destination }).info({ inputTokens: 12 }, 'model call');
    expect(records).toEqual([
      {
        level: 'info',
        time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
        name: 'bedrock',
        inputTokens: 12,
        msg: 'model call',
      },
    ]);
  });

  it('drops lines below the configured level', () => {
    const { records, destination } = memoryDestination();
    const logger = createLogger({ name: 'test', level: 'warn', destination });
    logger.info('not written');
    logger.warn('written');
    expect(records.map((record) => record.msg)).toEqual(['written']);
  });

  it('censors credentials if someone logs them by mistake', () => {
    const { records, destination } = memoryDestination();
    createLogger({ name: 'test', destination }).info({ jira: { apiToken: 'secret', authorization: 'Basic x' } });
    expect(JSON.stringify(records)).not.toContain('secret');
    expect(records[0]).toMatchObject({ jira: { apiToken: '[redacted]', authorization: '[redacted]' } });
  });
});
