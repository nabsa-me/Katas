import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandOutput,
  type StopReason,
} from '@aws-sdk/client-bedrock-runtime';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_ID } from '../claude-bedrock/bedrock-client';
import { createBedrockTextModel } from './bedrock-models';
import { classifyIssue, CLASSIFIER_SYSTEM_PROMPT } from './classifier';

const bedrock = mockClient(BedrockRuntimeClient);
beforeEach(() => bedrock.reset());

function converseReply(text: string, stopReason: StopReason = 'end_turn'): Partial<ConverseCommandOutput> {
  return {
    output: { message: { role: 'assistant', content: [{ text }] } },
    stopReason,
    usage: { inputTokens: 310, outputTokens: 42, totalTokens: 352 },
    metrics: { latencyMs: 870 },
  };
}

const model = () =>
  createBedrockTextModel({
    client: new BedrockRuntimeClient({ region: 'us-east-1' }),
    modelId: DEFAULT_MODEL_ID,
    maxTokens: 1024,
  });

describe('createBedrockTextModel', () => {
  it('sends the prompt through Converse and returns text, tokens and Bedrock’s latency', async () => {
    bedrock.on(ConverseCommand).resolves(converseReply(' {"workType":"incident","rationale":"Search is down."} '));

    const reply = await classifyIssue({ summary: 'Search is down in the EU region', description: '' }, model());

    expect(reply).toEqual({
      text: '{"workType":"incident","rationale":"Search is down."}',
      inputTokens: 310,
      outputTokens: 42,
      latencyMs: 870,
    });
    expect(bedrock.commandCalls(ConverseCommand)[0]?.args[0].input).toEqual({
      modelId: DEFAULT_MODEL_ID,
      system: [{ text: CLASSIFIER_SYSTEM_PROMPT }],
      messages: [
        { role: 'user', content: [{ text: 'Summary: Search is down in the EU region\nDescription: (none)' }] },
      ],
      inferenceConfig: { maxTokens: 1024 },
    });
  });

  it('refuses to hand over an answer that did not end normally', async () => {
    bedrock.on(ConverseCommand).resolves(converseReply('{"workType":', 'max_tokens'));
    await expect(model().complete('system', 'user')).rejects.toThrow('The model stopped with max_tokens');
  });
});
