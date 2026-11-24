# applied-ai

Four katas on building with Claude, solved and explained: calling Claude on Amazon Bedrock with the Converse API (in TypeScript and Python), an MCP server that gives Claude access to Jira, a Claude Code skill packaged as a plugin, and evals for an AI feature. Each one starts from a version that works in a demo and breaks in production (ignored stop reasons, no timeouts, untyped tools, a prompt pasted from a wiki, spot checks instead of tests) and ends with a tested fix. Nothing in the tests calls a model or AWS: Bedrock is faked with `aws-sdk-client-mock`, botocore's `Stubber` and a local HTTP/2 server, Jira with msw, and the eval runs a deterministic model. Real mode is optional, through `.env`.

## Run

Requires Node 22.12 or later, and Python 3.12 with [uv](https://docs.astral.sh/uv/) for the Python twin of the Bedrock exercise. No Docker, no ports, no accounts.

```bash
cd applied-ai
npm install
npm test                    # every TypeScript exercise, against mocks and local fakes
npm run check               # type checking, the skill's JavaScript helper included
npm run eval                # the eval gate with the deterministic model; exits 1 below the threshold
uv sync                     # Python environment for the boto3 twin
uv run pytest               # Python tests (botocore Stubber)
uv run ruff check           # Python lint
uv run ruff format --check  # Python formatting
```

Optional real mode, with your own AWS credentials, Jira site and Claude Code:

```bash
cp .env.example .env                                     # fill in your values; .env is never committed
npm run ask -- "What is the status of PLAT-104?"         # Claude on Bedrock with the get_issue tool
npm run mcp                                              # the Jira MCP server on stdio, for an MCP client
EVAL_MODEL=bedrock npm run eval                          # the eval against Claude on Bedrock (billed calls)
claude plugin validate --strict src/exercises/claude-code-skill-plugin/marketplace   # the plugin manifests
```

The statement, the explained solution and the common mistakes are in the `README.md` of each exercise folder. Each folder has the flawed version (`*.problem.ts`, or `release-process.problem.md`) next to the solution, and the tests run both.

## How to use these katas

1. Read the exercise statement (only the "Statement" section).
2. Try to solve it **yourself, in an empty project, without an assistant**. Official documentation only.
3. If you get stuck, read "How to approach it, step by step" and carry on.
4. When done, compare with the solution and read "Solution explained" and "Common mistakes".
5. Repeat the exercise another day without looking.

| Exercise                                                                         | What it practises                                                                                            |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [Claude on Amazon Bedrock](src/exercises/claude-bedrock/README.md)               | Converse and ConverseStream, the tool-use loop, every `stopReason`, timeouts, retries, cost logs, IAM, boto3 |
| [MCP server for Jira](src/exercises/mcp-server/README.md)                        | Tools with zod schemas and annotations, errors as tool results, stdio, `.mcp.json`, Streamable HTTP          |
| [Claude Code skill and plugin](src/exercises/claude-code-skill-plugin/README.md) | `SKILL.md` and its description as the trigger, helper scripts, plugin and marketplace, trigger tests         |
| [Evals for an AI feature](src/exercises/ai-evals/README.md)                      | Golden dataset, graders, LLM-as-judge rubric, p50 and p95, cost, a CI threshold, production monitoring       |

## Claude on Bedrock cheat sheet

| I need…                               | Use                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| To call Claude with the AWS SDK       | `ConverseCommand` (`client.converse` in boto3) with `modelId`, `system`, `messages`, `inferenceConfig`       |
| The model out of the code             | `BEDROCK_MODEL_ID`: a profile such as `global.anthropic.claude-opus-5-5`, or the in-Region model id          |
| To know whether I have an answer      | `stopReason`: only `end_turn` and `stop_sequence` are answers; handle every other value explicitly           |
| To give the model a tool              | `toolConfig.tools[].toolSpec` with `inputSchema.json`; answer every `toolUse` in the next user message       |
| A timeout and retries (TypeScript)    | `maxAttempts` and `requestHandler: new NodeHttp2Handler({ requestTimeout, disableConcurrentStreams: true })` |
| A timeout and retries (Python)        | `Config(read_timeout=…, retries={"mode": "standard", "total_max_attempts": n})`                              |
| Tokens, latency and cost of a call    | `usage`, `metrics.latencyMs`, and prices from a config file, always labelled as estimated                    |
| To show an answer while it is written | `ConverseStreamCommand`: text in `contentBlockDelta`, stop in `messageStop`, usage in `metadata`             |
| Least-privilege access                | `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream` on the profile and the models it routes to |
| Tests without AWS                     | `mockClient(BedrockRuntimeClient).on(ConverseCommand)`; botocore `Stubber`                                   |

## MCP and Claude Code cheat sheet

| I need…                                       | Use                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| A tool on an MCP server                       | `server.registerTool(name, { title, description, inputSchema: { …zod }, annotations }, handler)`  |
| To mark reads and writes                      | `readOnlyHint: true`; a write: `readOnlyHint: false`, plus `destructiveHint` and `idempotentHint` |
| A failure the model can act on                | Return `{ content: [{ type: 'text', text }], isError: true }` with what happened and what to do   |
| To test a server in-process                   | `InMemoryTransport.createLinkedPair()` and the SDK's `Client`                                     |
| Logs from a stdio server                      | stderr only: stdout is the protocol channel                                                       |
| A server in a project, without secrets in Git | `.mcp.json` with `${VAR}`, and `${CLAUDE_PROJECT_DIR:-.}` for paths; `claude mcp list` to check   |
| A skill                                       | `skills/<name>/SKILL.md` with a `description` that says when to use it and when not               |
| To run a bundled script without a prompt      | `allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/<script> *)`                                |
| To share skills with a team                   | A plugin (`.claude-plugin/plugin.json`) in a marketplace (`.claude-plugin/marketplace.json`)      |
| To check the manifests                        | `claude plugin validate --strict <path>`                                                          |
| To know whether a skill triggers              | Fresh sessions with and without `--plugin-dir`; `claude plugin eval` with `tool_used` graders     |

## Evals cheat sheet

| I need…                      | Use                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| Cases that catch regressions | A JSONL golden set with every label, named edge cases, and real failures added as they happen     |
| A label grader               | Exact match; a regex when more than one label is right                                            |
| A format grader              | The same schema the product parses with                                                           |
| To grade judgement           | An LLM judge with numbered yes/no criteria and a JSON verdict; an unreadable verdict fails        |
| Latency that means something | p50 and p95 (nearest rank), never only the average                                                |
| A CI gate                    | A deterministic model, a threshold in config, exit code 1 below it                                |
| To watch it in production    | Log tokens, latency, cost and stop reason per call; sample for the judge; alert on cost and drift |

## Data

`src/data/issues.json` holds **fictional** Jira issues of a `PLAT` project, used by the Bedrock tool and the fake Jira of the MCP server. The eval's `golden.jsonl` and the skill's `sample-service` migrations are fictional too. Names, account ids, sites and emails are made up; tokens and keys are `replace-with-…` placeholders.
