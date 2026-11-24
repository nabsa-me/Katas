import { ConverseCommand, type BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { textOf } from '../claude-bedrock/conversation';
import type { TextModel } from './classifier';

export interface BedrockTextModelOptions {
  client: BedrockRuntimeClient;
  modelId: string;
  maxTokens: number;
}

/**
 * A `TextModel` backed by Claude on Amazon Bedrock, built on the claude-bedrock exercise's client (timeout and
 * retries included). Only a complete answer counts: any other stop reason throws, and the runner records the case as
 * failed instead of grading a truncated or blocked reply.
 */
export function createBedrockTextModel({ client, modelId, maxTokens }: BedrockTextModelOptions): TextModel {
  return {
    id: modelId,
    pricingId: modelId,
    async complete(system, user) {
      const response = await client.send(
        new ConverseCommand({
          modelId,
          system: [{ text: system }],
          messages: [{ role: 'user', content: [{ text: user }] }],
          inferenceConfig: { maxTokens },
        }),
      );
      if (response.stopReason !== 'end_turn') throw new Error(`The model stopped with ${response.stopReason}`);
      return {
        text: textOf(response.output?.message?.content).trim(),
        inputTokens: response.usage?.inputTokens ?? 0,
        outputTokens: response.usage?.outputTokens ?? 0,
        latencyMs: response.metrics?.latencyMs ?? 0,
      };
    },
  };
}
