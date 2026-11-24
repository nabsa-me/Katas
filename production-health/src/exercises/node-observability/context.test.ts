import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { correlationIdFrom, currentContext, runOutsideContext, runWithContext } from './context';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('correlationIdFrom', () => {
  it.each(['3f2b8c1e-9d4a-4e7b-8a61-0c5d2e9f7b13', '01JD3V8Q4X9N2K7M5P6R8T0W1Y', 'gateway:7f3a9c21.0042'])(
    'reuses a safe id from the caller: %s',
    (id) => {
      expect(correlationIdFrom(id)).toBe(id);
    },
  );

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['a forged log line', 'abc\n{"level":"info","msg":"payment approved"}'],
    ['spaces and quotes', 'a b "c"'],
    ['too long', 'x'.repeat(129)],
  ])('creates a new UUID when the header is %s', (_, header) => {
    expect(correlationIdFrom(header)).toMatch(UUID);
  });

  it('takes the first value when the header is repeated', () => {
    expect(correlationIdFrom(['first-id', 'second-id'])).toBe('first-id');
  });
});

describe('request context', () => {
  it('follows each request through its own awaits, even when they overlap', async () => {
    const seen: string[] = [];
    const request = (id: string, delayMs: number) =>
      runWithContext({ correlationId: id }, async () => {
        await sleep(delayMs);
        seen.push(`${id} sees ${currentContext()?.correlationId}`);
      });

    await Promise.all([request('slow', 30), request('fast', 5)]);

    expect(seen).toEqual(['fast sees fast', 'slow sees slow']);
    expect(currentContext()).toBeUndefined();
  });

  it('can run code that belongs to no request from inside one', () => {
    runWithContext({ correlationId: 'request-f' }, () => {
      expect(runOutsideContext(() => currentContext())).toBeUndefined();
      expect(currentContext()?.correlationId).toBe('request-f');
    });
  });
});
