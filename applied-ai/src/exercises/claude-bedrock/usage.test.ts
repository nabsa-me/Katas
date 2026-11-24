import { describe, expect, it } from 'vitest';
import { createLogger, memoryDestination } from '../../lib/logger';
import { addUsage, defaultPricing, estimateCostUsd, logModelCall, toCallUsage, type Pricing } from './usage';

const PRICING: Pricing = {
  note: 'Test prices.',
  currency: 'USD',
  models: { 'test-model': { inputPerMillion: 3, outputPerMillion: 15 } },
};

describe('pricing.json', () => {
  it('says the prices are illustrative and where to verify them', () => {
    expect(defaultPricing.note).toMatch(/Illustrative[\s\S]*https:\/\/aws\.amazon\.com\/bedrock\/pricing\//);
  });

  it('prices the default model id', () => {
    expect(defaultPricing.models['global.anthropic.claude-opus-5-5']).toBeDefined();
  });
});

describe('estimateCostUsd', () => {
  it('prices input and output tokens per million', () => {
    const usage = toCallUsage({ inputTokens: 1_000, outputTokens: 500, totalTokens: 1_500 });
    expect(estimateCostUsd('test-model', usage, PRICING)).toBe(0.0105);
  });

  it('returns null for a model with no known price rather than guessing', () => {
    expect(estimateCostUsd('another-model', toCallUsage(undefined), PRICING)).toBeNull();
  });
});

describe('usage helpers', () => {
  it('treats missing token counts as zero and adds calls together', () => {
    const first = toCallUsage({ inputTokens: 10, outputTokens: 2, totalTokens: 12, cacheReadInputTokens: 100 });
    const total = addUsage(first, toCallUsage(undefined));
    expect(total).toEqual({ inputTokens: 10, outputTokens: 2, cacheReadInputTokens: 100, cacheWriteInputTokens: 0 });
  });
});

describe('logModelCall', () => {
  it('writes one line with the operation, tokens, latencies and estimated cost', () => {
    const { records, destination } = memoryDestination();
    logModelCall(
      createLogger({ name: 'claude-bedrock', destination }),
      {
        operation: 'Converse',
        modelId: 'test-model',
        stopReason: 'end_turn',
        usage: toCallUsage({ inputTokens: 1_000, outputTokens: 500, totalTokens: 1_500, cacheReadInputTokens: 300 }),
        latencyMs: 850,
        durationMs: 910,
      },
      PRICING,
    );
    expect(records).toEqual([
      expect.objectContaining({
        msg: 'model call',
        operation: 'Converse',
        modelId: 'test-model',
        stopReason: 'end_turn',
        inputTokens: 1_000,
        outputTokens: 500,
        cacheReadInputTokens: 300,
        latencyMs: 850,
        durationMs: 910,
        estimatedCostUsd: 0.0105,
      }),
    ]);
    expect(records[0]).not.toHaveProperty('cacheWriteInputTokens');
  });
});
