import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type ConverseCommandOutput,
  type StopReason,
} from '@aws-sdk/client-bedrock-runtime';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { createLogger, memoryDestination } from '../../lib/logger';
import { DEFAULT_MODEL_ID } from './bedrock-client';
import { askClaude } from './claude-bedrock.problem';
import { converse, ConversationError, SYSTEM_PROMPT, type ConversationOptions } from './conversation';
import { issueTools } from './tools';

const bedrock = mockClient(BedrockRuntimeClient);
beforeEach(() => bedrock.reset());

const QUESTION = 'What is the status of PLAT-104 and who is on it?';
const LOOKUP = { text: 'Let me look that up.' };
const GET_PLAT_104 = { toolUse: { toolUseId: 'tooluse-plat-104', name: 'get_issue', input: { key: 'PLAT-104' } } };

function reply(
  stopReason: StopReason,
  content: ContentBlock[],
  usage = { inputTokens: 400, outputTokens: 60 },
): Partial<ConverseCommandOutput> {
  return {
    output: { message: { role: 'assistant', content } },
    stopReason,
    usage: { ...usage, totalTokens: usage.inputTokens + usage.outputTokens },
    metrics: { latencyMs: 900 },
  };
}

function setup(overrides: Partial<ConversationOptions> = {}) {
  const { records, destination } = memoryDestination();
  let clock = 0;
  const options: ConversationOptions = {
    client: new BedrockRuntimeClient({ region: 'us-east-1' }),
    modelId: DEFAULT_MODEL_ID,
    maxTokens: 1024,
    system: SYSTEM_PROMPT,
    tools: issueTools,
    logger: createLogger({ name: 'claude-bedrock', destination }),
    now: () => (clock += 100),
    ...overrides,
  };
  const requests = () => bedrock.commandCalls(ConverseCommand).map((call) => call.args[0].input);
  return { options, records, requests };
}

describe('converse: the tool-use loop', () => {
  it('runs the requested tool, sends the result back and returns the final answer', async () => {
    bedrock
      .on(ConverseCommand)
      .resolvesOnce(reply('tool_use', [LOOKUP, GET_PLAT_104]))
      .resolvesOnce(
        reply('end_turn', [{ text: 'PLAT-104 is In Progress, assigned to Mei Tanaka.' }], {
          inputTokens: 520,
          outputTokens: 45,
        }),
      );
    const { options, requests } = setup();

    const result = await converse(QUESTION, options);

    expect(result).toEqual({
      outcome: 'answered',
      text: 'PLAT-104 is In Progress, assigned to Mei Tanaka.',
      stopReason: 'end_turn',
      modelCalls: 2,
      usage: { inputTokens: 920, outputTokens: 105, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 },
      estimatedCostUsd: 0.00578,
    });
    const [first, second] = requests();
    expect(first).toMatchObject({ modelId: DEFAULT_MODEL_ID, system: [{ text: SYSTEM_PROMPT }] });
    expect(first?.toolConfig?.tools?.[0]?.toolSpec?.name).toBe('get_issue');
    expect(first?.messages).toEqual([{ role: 'user', content: [{ text: QUESTION }] }]);
    expect(second?.messages).toEqual([
      { role: 'user', content: [{ text: QUESTION }] },
      { role: 'assistant', content: [LOOKUP, GET_PLAT_104] },
      {
        role: 'user',
        content: [
          {
            toolResult: {
              toolUseId: 'tooluse-plat-104',
              status: 'success',
              content: [{ json: expect.objectContaining({ key: 'PLAT-104', assignee: 'Mei Tanaka' }) }],
            },
          },
        ],
      },
    ]);
  });

  it('logs every model call with tokens, latency and estimated cost, and every tool call', async () => {
    bedrock
      .on(ConverseCommand)
      .resolvesOnce(reply('tool_use', [GET_PLAT_104]))
      .resolvesOnce(reply('end_turn', [{ text: 'Done.' }]));
    const { options, records } = setup();

    await converse(QUESTION, options);

    expect(records.map((record) => record.msg)).toEqual(['model call', 'tool call', 'model call']);
    expect(records[0]).toMatchObject({
      operation: 'Converse',
      modelId: DEFAULT_MODEL_ID,
      stopReason: 'tool_use',
      inputTokens: 400,
      outputTokens: 60,
      latencyMs: 900,
      durationMs: 100,
      estimatedCostUsd: 0.0028,
    });
    expect(records[1]).toMatchObject({ toolUseId: 'tooluse-plat-104', status: 'success' });
  });

  it('answers parallel tool calls with all the results in a single user message', async () => {
    const getPlat101 = { toolUse: { toolUseId: 'tooluse-plat-101', name: 'get_issue', input: { key: 'PLAT-101' } } };
    bedrock
      .on(ConverseCommand)
      .resolvesOnce(reply('tool_use', [GET_PLAT_104, getPlat101]))
      .resolvesOnce(reply('end_turn', [{ text: 'Both are in progress.' }]));
    const { options, requests } = setup();

    await converse('Compare PLAT-104 and PLAT-101', options);

    const toolResults = requests()[1]?.messages?.[2]?.content?.map((block) => block.toolResult?.toolUseId);
    expect(toolResults).toEqual(['tooluse-plat-104', 'tooluse-plat-101']);
  });

  it('sends the assistant turn back unchanged, reasoning blocks included', async () => {
    const reasoning: ContentBlock = {
      reasoningContent: { reasoningText: { text: 'The user wants PLAT-104.', signature: 'opaque-signature' } },
    };
    bedrock
      .on(ConverseCommand)
      .resolvesOnce(reply('tool_use', [reasoning, GET_PLAT_104]))
      .resolvesOnce(reply('end_turn', [{ text: 'In progress.' }]));
    const { options, requests } = setup();

    const result = await converse(QUESTION, options);

    expect(requests()[1]?.messages?.[1]).toEqual({ role: 'assistant', content: [reasoning, GET_PLAT_104] });
    expect(result.text).toBe('In progress.');
  });

  it('returns invalid tool input to the model as an error result and carries on', async () => {
    const badCall = { toolUse: { toolUseId: 'tooluse-bad', name: 'get_issue', input: { key: 'plat 104' } } };
    bedrock
      .on(ConverseCommand)
      .resolvesOnce(reply('tool_use', [badCall]))
      .resolvesOnce(reply('end_turn', [{ text: 'Which issue do you mean?' }]));
    const { options, requests } = setup();

    const result = await converse('How is plat 104 doing?', options);

    expect(result.outcome).toBe('answered');
    expect(requests()[1]?.messages?.[2]?.content?.[0]?.toolResult).toMatchObject({
      toolUseId: 'tooluse-bad',
      status: 'error',
      content: [{ text: expect.stringContaining('expected a Jira issue key') }],
    });
  });
});

describe('converse: every stop reason', () => {
  it('returns a truncated answer for max_tokens without running the half-written tool call', async () => {
    bedrock.on(ConverseCommand).resolves(reply('max_tokens', [{ text: 'PLAT-104 is' }, GET_PLAT_104]));
    const { options, records } = setup();

    const result = await converse(QUESTION, options);

    expect(result).toMatchObject({ outcome: 'truncated', text: 'PLAT-104 is', modelCalls: 1 });
    expect(records.some((record) => record.msg === 'tool call')).toBe(false);
  });

  it.each(['guardrail_intervened', 'content_filtered'] as const)(
    'reports %s as blocked, not as an answer',
    async (stop) => {
      bedrock.on(ConverseCommand).resolves(reply(stop, [{ text: 'Sorry, I cannot help with that.' }]));
      const { options } = setup();
      expect(await converse(QUESTION, options)).toMatchObject({ outcome: 'blocked', stopReason: stop });
    },
  );

  it('treats stop_sequence as a complete answer', async () => {
    bedrock.on(ConverseCommand).resolves(reply('stop_sequence', [{ text: 'PLAT-104: In Progress' }]));
    const { options } = setup();
    expect(await converse(QUESTION, options)).toMatchObject({ outcome: 'answered', text: 'PLAT-104: In Progress' });
  });

  it.each(['malformed_model_output', 'malformed_tool_use', 'model_context_window_exceeded'] as const)(
    'throws a ConversationError for %s',
    async (stop) => {
      bedrock.on(ConverseCommand).resolves(reply(stop, []));
      const { options } = setup();
      await expect(converse(QUESTION, options)).rejects.toMatchObject({ name: 'ConversationError', stopReason: stop });
    },
  );

  it('throws for a stop reason this code does not know', async () => {
    bedrock.on(ConverseCommand).resolves(reply('some_future_reason' as StopReason, []));
    const { options } = setup();
    await expect(converse(QUESTION, options)).rejects.toThrow('Unexpected stop reason: some_future_reason');
  });

  it('stops a model that keeps asking for tools after maxModelCalls', async () => {
    bedrock.on(ConverseCommand).resolves(reply('tool_use', [GET_PLAT_104]));
    const { options, requests } = setup({ maxModelCalls: 3 });
    await expect(converse(QUESTION, options)).rejects.toThrow(ConversationError);
    expect(requests()).toHaveLength(3);
  });
});

describe('flawed askClaude', () => {
  it('returns the tool-call preamble as if it were the answer, and never runs the tool', async () => {
    bedrock.on(ConverseCommand).resolves(reply('tool_use', [LOOKUP, GET_PLAT_104]));
    expect(await askClaude(QUESTION)).toBe('Let me look that up.');
    expect(bedrock.commandCalls(ConverseCommand)).toHaveLength(1);
  });

  it('returns a cut-off answer as if it were complete', async () => {
    bedrock.on(ConverseCommand).resolves(reply('max_tokens', [{ text: 'PLAT-104 is assigned to' }]));
    expect(await askClaude(QUESTION)).toBe('PLAT-104 is assigned to');
  });
});
