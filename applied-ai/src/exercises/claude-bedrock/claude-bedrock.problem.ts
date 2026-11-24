import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { ConnectionOverrides } from './bedrock-client';
import { issueTools } from './tools';

/**
 * Flawed: the client as it is often first written. The overrides only exist so tests can point it at a local fake
 * server; they do not change its behaviour.
 */
export function createProblemClient(overrides: ConnectionOverrides = {}): BedrockRuntimeClient {
  // BUG: a single attempt, so one ThrottlingException fails the call. And no request timeout: a stalled
  // connection waits for the HTTP/2 session's idle timeout (five minutes) before anything happens.
  return new BedrockRuntimeClient({ region: 'us-east-1', maxAttempts: 1, ...overrides });
}

/** Flawed: asks a question and returns "the answer". */
export async function askClaude(question: string, client = createProblemClient()): Promise<string> {
  const response = await client.send(
    new ConverseCommand({
      // BUG: model id hardcoded, so changing model, Region or inference profile means a code change and a deploy.
      modelId: 'anthropic.claude-opus-5-5',
      messages: [{ role: 'user', content: [{ text: question }] }],
      inferenceConfig: { maxTokens: 512 },
      toolConfig: { tools: issueTools.specs },
    }),
  );
  // BUG: stopReason is ignored. With `tool_use` this returns the model's "let me look that up" preamble as the
  // answer and never runs the tool; with `max_tokens` a cut-off answer looks complete; a guardrail looks like success.
  // BUG: usage and latency are dropped: nobody can say what a question costs or how long it takes.
  return response.output?.message?.content?.[0]?.text ?? '';
}
