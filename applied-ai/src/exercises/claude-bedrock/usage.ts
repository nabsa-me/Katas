import type { TokenUsage } from '@aws-sdk/client-bedrock-runtime';
import { z } from 'zod';
import type { Logger } from '../../lib/logger';
import pricingData from './pricing.json';

const modelPriceSchema = z.object({
  inputPerMillion: z.number().nonnegative(),
  outputPerMillion: z.number().nonnegative(),
});

/** Prices live in a config file with a note that they must be verified; the code never states a price as fact. */
export const pricingSchema = z.object({
  note: z.string().min(1),
  currency: z.literal('USD'),
  models: z.record(z.string(), modelPriceSchema),
});

export type Pricing = z.infer<typeof pricingSchema>;

export const defaultPricing: Pricing = pricingSchema.parse(pricingData);

/** Token counts of one call or of a whole conversation, with missing values as 0. */
export interface CallUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheWriteInputTokens: number;
}

export const NO_USAGE: CallUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheWriteInputTokens: 0,
};

export function toCallUsage(usage: TokenUsage | undefined): CallUsage {
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    cacheReadInputTokens: usage?.cacheReadInputTokens ?? 0,
    cacheWriteInputTokens: usage?.cacheWriteInputTokens ?? 0,
  };
}

export function addUsage(a: CallUsage, b: CallUsage): CallUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
    cacheWriteInputTokens: a.cacheWriteInputTokens + b.cacheWriteInputTokens,
  };
}

/**
 * Estimated cost in USD of the input and output tokens, or `null` when the model id is not in the price table:
 * an unknown price is reported as unknown, never guessed. Cache reads and writes are priced differently and are
 * logged as token counts only.
 */
export function estimateCostUsd(modelId: string, usage: CallUsage, pricing: Pricing = defaultPricing): number | null {
  const price = pricing.models[modelId];
  if (!price) return null;
  const cost = (usage.inputTokens * price.inputPerMillion + usage.outputTokens * price.outputPerMillion) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export interface ModelCallRecord {
  operation: 'Converse' | 'ConverseStream';
  modelId: string;
  stopReason: string | undefined;
  usage: CallUsage;
  /** Model latency reported by Bedrock (`metrics.latencyMs`). */
  latencyMs: number | undefined;
  /** Wall-clock time seen by the caller: network, queueing and SDK retries included. */
  durationMs: number;
}

/** One structured log line per model call: what it cost, how long it took and why it stopped. */
export function logModelCall(logger: Logger, record: ModelCallRecord, pricing: Pricing = defaultPricing): void {
  const { usage, ...rest } = record;
  logger.info(
    {
      ...rest,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      ...(usage.cacheReadInputTokens ? { cacheReadInputTokens: usage.cacheReadInputTokens } : {}),
      ...(usage.cacheWriteInputTokens ? { cacheWriteInputTokens: usage.cacheWriteInputTokens } : {}),
      estimatedCostUsd: estimateCostUsd(record.modelId, usage, pricing),
    },
    'model call',
  );
}
