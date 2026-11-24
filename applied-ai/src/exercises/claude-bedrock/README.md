# Claude on Amazon Bedrock

## Statement

An internal assistant answers questions about Jira issues with Claude on Amazon Bedrock. The model has one tool, `get_issue`, to read an issue by key. The first version, written in an afternoon, looks like this:

```ts
const client = new BedrockRuntimeClient({ region: 'us-east-1', maxAttempts: 1 });
const response = await client.send(
  new ConverseCommand({
    modelId: 'anthropic.claude-opus-5-5',
    messages: [{ role: 'user', content: [{ text: question }] }],
    inferenceConfig: { maxTokens: 512 },
    toolConfig: { tools: issueTools.specs },
  }),
);
return response.output?.message?.content?.[0]?.text ?? '';
```

Symptoms: users get "Let me look that up." as the whole answer; long answers stop mid-sentence and look complete; at busy hours some questions fail with `ThrottlingException`; when a connection stalls, the request hangs for minutes; moving to another Region or inference profile needs a code change; and nobody can say what a question costs. Rewrite it in TypeScript with `@aws-sdk/client-bedrock-runtime`, and again in Python with `boto3`: configuration from the environment, a client with a timeout and retries, a complete tool-use loop that handles every `stopReason`, streaming with ConverseStream, one log line per call with tokens, latency and estimated cost, and a least-privilege IAM policy.

## What gets assessed

- The Converse API: request (`messages`, `system`, `inferenceConfig`, `toolConfig`) and response (`output.message`, `stopReason`, `usage`, `metrics.latencyMs`), and the same for ConverseStream events.
- A complete tool-use loop: every requested tool runs, all the results go back in one user message, the assistant turn goes back unchanged, and a call budget stops a model that never finishes.
- Every stop reason handled explicitly, so a truncated, blocked or malformed turn is never shown as an answer.
- Resilience: a request timeout and a retry budget, and knowing which errors are retried (throttling, 5xx, timeouts) and which are not (validation, permissions).
- Cost and least privilege: tokens and estimated cost per call from a prices file that is not presented as fact, and an IAM policy scoped to one inference profile.

## How to approach it, step by step

1. Send one Converse request with the tool and print the whole response. Notice `stopReason: 'tool_use'`, the `toolUse` block next to the text, and `usage`.
2. Move the Region, model id, timeout, attempts and `maxTokens` to environment variables, validated with zod; fail at startup listing every invalid value.
3. Configure the client: `maxAttempts` and a request handler with `requestTimeout`. Prove each behaviour against a local fake server: throttled → retried, stalled → timed out and retried, invalid → not retried.
4. Write the tool: a JSON Schema generated from a zod schema for the spec, and a runner that validates the model's input and returns every failure as an error result.
5. Write the loop as a `switch` over `stopReason`, with a `default` that throws, and a maximum number of model calls.
6. Add usage: normalize the token counts, estimate the cost from `pricing.json`, and log one structured line per call.
7. Add streaming: accumulate the text deltas, read the stop reason from `messageStop` and the usage from `metadata`, and turn error events into an exception.
8. Write the IAM policy for the inference profile and the foundation models it routes to, and test its shape.
9. Port the loop to Python with boto3 and test it with botocore's `Stubber`.

## Solution explained

[`bedrock-client.ts`](./bedrock-client.ts) reads the configuration and builds the client, [`tools.ts`](./tools.ts) defines and runs `get_issue`, [`conversation.ts`](./conversation.ts) is the tool-use loop, [`stream.ts`](./stream.ts) the streaming answer, and [`usage.ts`](./usage.ts) with [`pricing.json`](./pricing.json) the usage log and cost estimate. [`ask.ts`](./ask.ts) is the optional real-mode CLI, [`iam-policy.json`](./iam-policy.json) the policy, and [`claude-bedrock.problem.ts`](./claude-bedrock.problem.ts) the flawed version. The Python twin is in [`python/`](./python/bedrock_converse.py).

**Configuration, not code.** [`loadBedrockConfig()`](./bedrock-client.ts) needs only `AWS_REGION`; the rest has defaults: `BEDROCK_MODEL_ID` (`global.anthropic.claude-opus-5-5`), `BEDROCK_TIMEOUT_MS` (120 s), `BEDROCK_MAX_ATTEMPTS` (3) and `BEDROCK_MAX_TOKENS` (16,000). The model id is configuration because it changes with the Region and with data-residency rules: `global.anthropic.claude-opus-5-5` is a global cross-Region inference profile (Bedrock serves the request from any commercial Region with capacity), `us.` or `eu.` profiles keep traffic inside a geography, and the in-Region id `anthropic.claude-opus-5-5` only works in the few Regions that host the model. Credentials are never configured here: the SDK's default chain finds an SSO profile, environment variables or the role of the container or instance.

**A timeout and a retry budget.** The client is built with `maxAttempts` and a request handler:

```ts
new BedrockRuntimeClient({
  region: config.region,
  maxAttempts: config.maxAttempts,
  requestHandler: new NodeHttp2Handler({ requestTimeout: config.timeoutMs, disableConcurrentStreams: true }),
});
```

Bedrock Runtime's default handler is already `NodeHttp2Handler` with `disableConcurrentStreams: true`, but with no request timeout: a stalled request waits until the HTTP/2 session's idle timeout (five minutes) closes it. Passing `NodeHttpHandler`, the usual example, would silently downgrade the client to HTTP/1.1, so the same handler is kept and only `requestTimeout` is added. It measures inactivity on the stream: if nothing arrives for that long, the attempt fails with `TimeoutError`, which the standard retry strategy treats as transient, like `ThrottlingException` (429) and 5xx errors. It waits `random × min(base × 2^attempt, 20 s)` between attempts, with a base of 100 ms (500 ms after throttling). A 400 such as `ValidationException` or a 403 `AccessDeniedException` fails at once: retrying cannot fix it. Two consequences to plan for: the worst-case wall-clock time is about `timeout × attempts` plus the backoff, and a non-streaming Converse sends nothing until the whole answer is generated, so the timeout must be longer than the slowest answer you accept (or the answer must be streamed).

[`fake-bedrock-server.ts`](./fake-bedrock-server.ts) proves this with the real SDK: it is a local HTTP/2 server without TLS that answers like Bedrock, one scripted reply per request, or never answers (`'stall'`). [`bedrock-client.test.ts`](./bedrock-client.test.ts) checks the request path (`/model/{modelId}/converse`), a 429 retried and then answered (`$metadata.attempts` is 2), a stalled attempt abandoned after 300 ms and retried, three stalls ending in `TimeoutError`, and a `ValidationException` sent only once. The flawed client fails on the first throttle and is still waiting on a stalled request after a second.

**The tool-use loop.** [`converse()`](./conversation.ts) calls the model and decides by `stopReason`. With `tool_use`, it runs every `toolUse` block of the turn, sends all the results back in a single user message (each `toolResult` carries the `toolUseId` it answers), and calls the model again:

```ts
case 'tool_use': {
  const toolUses = (message.content ?? []).flatMap((block) => (block.toolUse ? [block.toolUse] : []));
  const results = await Promise.all(toolUses.map((toolUse) => tools.run(toolUse)));
  messages.push({ role: 'user', content: results.map((toolResult) => ({ toolResult })) });
  continue;
}
```

Claude expects every `toolUse` of a turn to be answered in the next user message: splitting parallel results across several messages, or dropping a failed one, breaks that pairing. Each request gets a copy of the history (`[...messages]`), so what was sent is exactly what the tests inspect. `maxModelCalls` (5 by default) ends a conversation in which the model keeps asking for tools: every round trip is a billed call.

**Every stop reason, explicitly.**

| `stopReason`                                                                    | What the loop does                                                                      |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `end_turn`, `stop_sequence`                                                     | Returns the text as `answered`.                                                         |
| `tool_use`                                                                      | Runs the tools, sends the results, calls the model again.                               |
| `max_tokens`                                                                    | Returns `truncated` and never runs the turn's tool calls: the last one may be cut.      |
| `guardrail_intervened`, `content_filtered`                                      | Returns `blocked`, so the caller can show a refusal message and count it.               |
| `malformed_model_output`, `malformed_tool_use`, `model_context_window_exceeded` | Throws `ConversationError` with the stop reason: none of them is an answer.             |
| anything else                                                                   | Throws `Unexpected stop reason`: a value added to the API later is never taken as text. |

**The assistant turn goes back unchanged.** Claude Opus 5.5 always reasons before answering, and Converse can return that reasoning as `reasoningContent` blocks with a signature. The loop appends `response.output.message` exactly as received, reasoning included, because the next call needs it intact; [`textOf()`](./conversation.ts) reads only the text blocks for the answer. The request sets no `temperature`, `topP` or forced `toolChoice`: on the Claude API, Claude Opus 5.5 rejects sampling parameters and a forced tool choice (`any` or a named tool). ⚠️ Verify whether Bedrock rejects them the same way for this model: https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-anthropic-claude-messages.html

**Tool input is external data.** [`runTool()`](./tools.ts) validates the model's input with the same zod schema that generated the spec (`z.toJSONSchema()`, with the `$schema` line removed). An unknown tool, an invalid key or a missing issue becomes `{ status: 'error', content: [{ text }] }`, a message the model can act on ("Which issue do you mean?"), never an exception that ends the conversation. The description says what the tool returns, when to use it and what it cannot do: that text is how the model chooses tools.

**One log line per model call.** [`logModelCall()`](./usage.ts) writes, with pino:

```json
{
  "level": "info",
  "name": "claude-bedrock",
  "operation": "Converse",
  "modelId": "global.anthropic.claude-opus-5-5",
  "stopReason": "tool_use",
  "latencyMs": 900,
  "durationMs": 1210,
  "inputTokens": 400,
  "outputTokens": 60,
  "estimatedCostUsd": 0.0028,
  "msg": "model call"
}
```

`latencyMs` is the model latency Bedrock reports (`metrics.latencyMs`); `durationMs` is what the caller waited, network and retries included; the gap between them is your overhead. Cache read and write tokens are added when present. Prices live in [`pricing.json`](./pricing.json), keyed by the exact model or profile id, with a note that they are illustrative and must be checked against the Bedrock pricing page; an id that is not in the file gives `estimatedCostUsd: null`, never a guess. Each line is labelled "estimated": the bill is the source of truth. In the CLI, logs go to stderr and the answer to stdout.

**Streaming.** [`streamAnswer()`](./stream.ts) sends ConverseStream and reads the events: text arrives in `contentBlockDelta`, the stop reason in `messageStop`, and the usage and latency only at the end, in `metadata`. `firstTextMs` records the time to the first fragment, which is what a user perceives as speed. The SDK retries the request until the stream starts; after that, an error arrives as an event (`throttlingException`, `modelStreamErrorException`, …) and becomes a `StreamError`, with the partial text already delivered through `onText`. Streaming needs its own IAM action, `bedrock:InvokeModelWithResponseStream`.

**A least-privilege IAM policy.** [`iam-policy.json`](./iam-policy.json) allows only `bedrock:InvokeModel` (Converse) and `bedrock:InvokeModelWithResponseStream` (ConverseStream). The first statement names the inference profile ARN in the source Region. A global profile then invokes the foundation model in whichever Region serves the request, so the second statement allows the model in the source Region and Region-less (`arn:aws:bedrock:::foundation-model/anthropic.claude-opus-5-5`), but only through that profile (`bedrock:InferenceProfileArn` condition): nobody can call the model directly. An organization that must keep data in one geography can deny global routing (a `Deny` with `aws:RequestedRegion` equal to `unspecified`) and use a `us.` or `eu.` profile. [`iam-policy.test.ts`](./iam-policy.test.ts) checks the actions, the absence of wildcards and the condition.

**The Python twin.** [`bedrock_converse.py`](./python/bedrock_converse.py) has the same loop, outcomes and log fields, and [`issue_tool.py`](./python/issue_tool.py) the same tool over the same fictional issues. The client gets `Config(connect_timeout=5, read_timeout=…, retries={"mode": "standard", "total_max_attempts": …})`: in botocore, `total_max_attempts` includes the first call while `max_attempts` counts only retries, and a read timeout is retried in standard mode. [`test_bedrock_converse.py`](./python/test_bedrock_converse.py) uses `Stubber`, which compares each request with the expected parameters (the second Converse request must contain the question, the assistant turn and the tool result) and validates each stubbed response against the service model. An event stream cannot be written as a stubbed response, so the streaming test uses a minimal fake client that yields the events.

**How it is proven.** Nothing calls AWS. `conversation.test.ts` and `stream.test.ts` use `aws-sdk-client-mock` to script a conversation with one tool call, parallel calls, reasoning blocks, invalid tool input and every stop reason, and assert the exact requests sent and the log lines written; the flawed `askClaude` returns "Let me look that up." without running the tool, and a cut-off answer as if it were complete. `bedrock-client.test.ts` runs the real client against the fake HTTP/2 server. `tools.test.ts`, `usage.test.ts` and `iam-policy.test.ts` cover the rest; `uv run pytest` runs the Python twin.

**Real mode (optional).** With AWS credentials and model access, copy `.env.example` to `.env` and run `npm run ask -- "What is the status of PLAT-104?"` or `npm run ask -- --stream "…"`. Exit codes: 0 answered, 1 unexpected error, 2 invalid configuration, 3 no complete answer.

## Common mistakes

| Symptom                                                    | Cause                                                                                                    |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| The answer is "Let me look that up."                       | `stopReason` is ignored: the turn was a `tool_use`, and its first text block is returned as the answer.  |
| An answer stops mid-sentence and nobody notices            | `max_tokens` is treated like `end_turn`.                                                                 |
| `ValidationException` on the second call of the loop       | A tool result is missing, split across messages, or has a `toolUseId` that does not match.               |
| `ValidationException: … model identifier is invalid`       | An in-Region model id used where only an inference profile is offered, or the reverse.                   |
| `AccessDeniedException` with a global inference profile    | The policy allows the profile but not the foundation model in the destination Regions (Region-less ARN). |
| Requests hang for minutes                                  | No `requestTimeout`; or `NodeHttpHandler` swapped in, changing the protocol as well.                     |
| Every timeout costs three times the timeout                | Timeouts are retried: size `timeoutMs × maxAttempts` against the caller's own deadline.                  |
| Cost dashboards show `null`                                | The model id in the logs is not in `pricing.json`: profiles and in-Region ids are different keys.        |
| A ConverseStream works locally and fails with 403 deployed | The role allows `bedrock:InvokeModel` only; streaming needs `bedrock:InvokeModelWithResponseStream`.     |

## Practice

Make the tool loop stream: send ConverseStream with the tools, rebuild each tool call from `contentBlockStart` (`toolUseId`, `name`) and the `contentBlockDelta.toolUse.input` fragments (JSON text to concatenate and parse at `contentBlockStop`), and test it with a scripted stream that asks for `get_issue`.
