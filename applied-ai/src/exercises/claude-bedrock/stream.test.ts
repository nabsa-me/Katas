import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  ModelStreamErrorException,
  type ConverseStreamOutput,
} from '@aws-sdk/client-bedrock-runtime';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { createLogger, memoryDestination } from '../../lib/logger';
import { DEFAULT_MODEL_ID } from './bedrock-client';
import { SYSTEM_PROMPT } from './conversation';
import { streamAnswer, StreamError, type StreamOptions } from './stream';

const bedrock = mockClient(BedrockRuntimeClient);
beforeEach(() => bedrock.reset());

async function* events(...items: ConverseStreamOutput[]): AsyncGenerator<ConverseStreamOutput> {
  for (const item of items) yield item;
}

const delta = (text: string): ConverseStreamOutput => ({
  contentBlockDelta: { contentBlockIndex: 0, delta: { text } },
});

function setup() {
  const { records, destination } = memoryDestination();
  const fragments: string[] = [];
  let clock = 0;
  const options: StreamOptions = {
    client: new BedrockRuntimeClient({ region: 'us-east-1' }),
    modelId: DEFAULT_MODEL_ID,
    maxTokens: 1024,
    system: SYSTEM_PROMPT,
    logger: createLogger({ name: 'claude-bedrock', destination }),
    onText: (fragment) => fragments.push(fragment),
    now: () => (clock += 50),
  };
  return { options, records, fragments };
}

describe('streamAnswer', () => {
  it('accumulates text deltas, reads the stop reason and takes usage and latency from the metadata event', async () => {
    bedrock.on(ConverseStreamCommand).resolves({
      stream: events(
        { messageStart: { role: 'assistant' } },
        { contentBlockStart: { contentBlockIndex: 0, start: undefined } },
        delta('Release notes '),
        delta('are ready.'),
        { contentBlockStop: { contentBlockIndex: 0 } },
        { messageStop: { stopReason: 'end_turn' } },
        {
          metadata: {
            usage: { inputTokens: 1_000, outputTokens: 250, totalTokens: 1_250 },
            metrics: { latencyMs: 2_400 },
          },
        },
      ),
    });
    const { options, records, fragments } = setup();

    const result = await streamAnswer('Summarize the release', options);

    expect(fragments).toEqual(['Release notes ', 'are ready.']);
    expect(result).toEqual({
      text: 'Release notes are ready.',
      stopReason: 'end_turn',
      usage: { inputTokens: 1_000, outputTokens: 250, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 },
      firstTextMs: 50,
      estimatedCostUsd: 0.009,
    });
    expect(records).toEqual([
      expect.objectContaining({
        msg: 'model call',
        operation: 'ConverseStream',
        stopReason: 'end_turn',
        inputTokens: 1_000,
        outputTokens: 250,
        latencyMs: 2_400,
        estimatedCostUsd: 0.009,
      }),
    ]);
    expect(bedrock.commandCalls(ConverseStreamCommand)[0]?.args[0].input).toMatchObject({
      modelId: DEFAULT_MODEL_ID,
      inferenceConfig: { maxTokens: 1024 },
    });
  });

  it('reports max_tokens so the caller knows the text was cut', async () => {
    bedrock.on(ConverseStreamCommand).resolves({
      stream: events(delta('The release'), { messageStop: { stopReason: 'max_tokens' } }),
    });
    const { options } = setup();
    expect(await streamAnswer('Summarize the release', options)).toMatchObject({
      text: 'The release',
      stopReason: 'max_tokens',
    });
  });

  it('throws when the stream fails midway, after delivering the partial text', async () => {
    bedrock.on(ConverseStreamCommand).resolves({
      stream: events(delta('Partial '), {
        modelStreamErrorException: new ModelStreamErrorException({ message: 'Model stream error', $metadata: {} }),
      }),
    });
    const { options, fragments } = setup();
    await expect(streamAnswer('Summarize the release', options)).rejects.toThrow(StreamError);
    expect(fragments).toEqual(['Partial ']);
  });
});
