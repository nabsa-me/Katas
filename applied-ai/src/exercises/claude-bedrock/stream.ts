import { ConverseStreamCommand, type BedrockRuntimeClient, type StopReason } from '@aws-sdk/client-bedrock-runtime';
import type { Logger } from '../../lib/logger';
import { estimateCostUsd, logModelCall, toCallUsage, type CallUsage, type Pricing } from './usage';

export interface StreamOptions {
  client: BedrockRuntimeClient;
  modelId: string;
  maxTokens: number;
  system: string;
  logger: Logger;
  pricing?: Pricing;
  /** Called with each text fragment as it arrives, to show the answer while it is generated. */
  onText?: (fragment: string) => void;
  now?: () => number;
}

export interface StreamResult {
  text: string;
  stopReason: StopReason | undefined;
  usage: CallUsage;
  /** Time from sending the request to the first text fragment: what a user perceives as speed. */
  firstTextMs: number | undefined;
  estimatedCostUsd: number | null;
}

export class StreamError extends Error {
  override name = 'StreamError';
}

/**
 * Streams one answer with ConverseStream. Text arrives as `contentBlockDelta` events and is accumulated; the stop
 * reason comes in `messageStop`, and the token usage and latency only at the end, in `metadata`. The SDK retries
 * the request until the stream starts; an error event after that is thrown here, with the partial text already
 * delivered through `onText`, and the caller decides whether to retry the whole answer.
 */
export async function streamAnswer(question: string, options: StreamOptions): Promise<StreamResult> {
  const { client, modelId, maxTokens, system, logger, pricing, onText, now = Date.now } = options;
  const startedAt = now();
  const response = await client.send(
    new ConverseStreamCommand({
      modelId,
      system: [{ text: system }],
      messages: [{ role: 'user', content: [{ text: question }] }],
      inferenceConfig: { maxTokens },
    }),
  );
  if (!response.stream) throw new StreamError('The response has no event stream');

  let text = '';
  let stopReason: StopReason | undefined;
  let usage = toCallUsage(undefined);
  let latencyMs: number | undefined;
  let firstTextMs: number | undefined;

  for await (const event of response.stream) {
    const fragment = event.contentBlockDelta?.delta?.text;
    if (fragment !== undefined) {
      firstTextMs ??= now() - startedAt;
      text += fragment;
      onText?.(fragment);
    } else if (event.messageStop) {
      stopReason = event.messageStop.stopReason;
    } else if (event.metadata) {
      usage = toCallUsage(event.metadata.usage);
      latencyMs = event.metadata.metrics?.latencyMs;
    } else {
      const failure =
        event.throttlingException ??
        event.serviceUnavailableException ??
        event.internalServerException ??
        event.modelStreamErrorException ??
        event.validationException;
      if (failure) throw new StreamError(`The stream failed after ${text.length} characters: ${failure.message}`);
    }
  }

  const durationMs = now() - startedAt;
  logModelCall(logger, { operation: 'ConverseStream', modelId, stopReason, usage, latencyMs, durationMs }, pricing);
  return { text, stopReason, usage, firstTextMs, estimatedCostUsd: estimateCostUsd(modelId, usage, pricing) };
}
