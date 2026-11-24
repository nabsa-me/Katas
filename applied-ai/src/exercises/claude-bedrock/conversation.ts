import {
  ConverseCommand,
  type BedrockRuntimeClient,
  type ContentBlock,
  type Message,
  type StopReason,
} from '@aws-sdk/client-bedrock-runtime';
import type { Logger } from '../../lib/logger';
import type { ToolRegistry } from './tools';
import { addUsage, estimateCostUsd, logModelCall, NO_USAGE, toCallUsage, type CallUsage, type Pricing } from './usage';

export interface ConversationOptions {
  client: BedrockRuntimeClient;
  modelId: string;
  maxTokens: number;
  system: string;
  tools: ToolRegistry;
  logger: Logger;
  pricing?: Pricing;
  /** Guard against a model that keeps asking for tools: each round trip is a billed call. */
  maxModelCalls?: number;
  now?: () => number;
}

export interface ConversationResult {
  /** `answered`: a complete answer. `truncated`: cut by `maxTokens`. `blocked`: stopped by a guardrail or filter. */
  outcome: 'answered' | 'truncated' | 'blocked';
  text: string;
  stopReason: StopReason;
  modelCalls: number;
  usage: CallUsage;
  estimatedCostUsd: number | null;
}

/** A stop that the caller cannot treat as an answer. `stopReason` says which one, so it can be counted and alerted on. */
export class ConversationError extends Error {
  override name = 'ConversationError';
  readonly stopReason: string | undefined;

  constructor(message: string, stopReason?: string) {
    super(message);
    this.stopReason = stopReason;
  }
}

export const SYSTEM_PROMPT =
  'You answer questions about the Jira issues of the PLAT project. Use the get_issue tool to read an issue before ' +
  'describing it; never invent status, assignees or dates. If an issue does not exist, say so.';

/** The text of a message: its text blocks only (tool calls and reasoning blocks are not part of the answer). */
export function textOf(content: ContentBlock[] | undefined): string {
  return (content ?? []).flatMap((block) => (block.text === undefined ? [] : [block.text])).join('');
}

/**
 * Asks one question and runs the tool-use loop until the model gives a final answer: call the model; if it stops
 * with `tool_use`, run every requested tool, send all the results back in one user message, and call it again.
 * Every stop reason is handled explicitly, and every call is logged with its tokens, latency and estimated cost.
 */
export async function converse(question: string, options: ConversationOptions): Promise<ConversationResult> {
  const { client, modelId, maxTokens, system, tools, logger, pricing, maxModelCalls = 5, now = Date.now } = options;
  const messages: Message[] = [{ role: 'user', content: [{ text: question }] }];
  let usage = NO_USAGE;

  for (let call = 1; call <= maxModelCalls; call++) {
    const startedAt = now();
    const response = await client.send(
      new ConverseCommand({
        modelId,
        system: [{ text: system }],
        messages: [...messages], // a snapshot: the history keeps growing after this request
        inferenceConfig: { maxTokens },
        toolConfig: { tools: tools.specs },
      }),
    );
    const callUsage = toCallUsage(response.usage);
    usage = addUsage(usage, callUsage);
    const { stopReason } = response;
    const latencyMs = response.metrics?.latencyMs;
    logModelCall(
      logger,
      { operation: 'Converse', modelId, stopReason, usage: callUsage, latencyMs, durationMs: now() - startedAt },
      pricing,
    );

    const message = response.output?.message;
    if (!message || !stopReason)
      throw new ConversationError('The response has no message or no stop reason', stopReason);
    // The assistant turn goes back exactly as received, reasoning blocks included: the next call needs it intact.
    messages.push(message);

    const result = (outcome: ConversationResult['outcome']): ConversationResult => ({
      outcome,
      text: textOf(message.content),
      stopReason,
      modelCalls: call,
      usage,
      estimatedCostUsd: estimateCostUsd(modelId, usage, pricing),
    });

    switch (stopReason) {
      case 'end_turn':
      case 'stop_sequence':
        return result('answered');
      case 'max_tokens':
        // Never run tools from a truncated turn: the last tool call may be cut in half.
        return result('truncated');
      case 'guardrail_intervened':
      case 'content_filtered':
        return result('blocked');
      case 'tool_use': {
        const toolUses = (message.content ?? []).flatMap((block) => (block.toolUse ? [block.toolUse] : []));
        if (toolUses.length === 0)
          throw new ConversationError('stopReason is tool_use but no tool was requested', stopReason);
        const results = await Promise.all(toolUses.map((toolUse) => tools.run(toolUse)));
        for (const toolResult of results)
          logger.info({ toolUseId: toolResult.toolUseId, status: toolResult.status }, 'tool call');
        messages.push({ role: 'user', content: results.map((toolResult) => ({ toolResult })) });
        continue;
      }
      case 'malformed_model_output':
      case 'malformed_tool_use':
        throw new ConversationError(
          `The model produced invalid output (${stopReason}); retry or simplify the tool schemas`,
          stopReason,
        );
      case 'model_context_window_exceeded':
        throw new ConversationError(
          'The conversation no longer fits the context window; trim or summarize it',
          stopReason,
        );
      default:
        throw new ConversationError(`Unexpected stop reason: ${String(stopReason)}`, stopReason);
    }
  }
  throw new ConversationError(`No final answer after ${maxModelCalls} model calls`);
}
