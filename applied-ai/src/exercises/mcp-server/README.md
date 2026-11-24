# MCP server for Jira

## Statement

A team wants Claude Code and Claude Desktop to search their Jira issues and comment on them, so someone wrote an MCP server with the official TypeScript SDK:

```ts
server.registerTool('jira', { description: 'Talks to Jira', inputSchema: z.any() }, async (args: any) => {
  if (args.action === 'search') {
    const data: any = await (await fetch(`${baseUrl}/rest/api/3/search/jql`, {/* … */})).json();
    return { content: [{ type: 'text', text: JSON.stringify(data.issues.map((i: any) => i.fields.summary)) }] };
  }
  const res = await fetch(`${baseUrl}/rest/api/3/issue/${args.issueKey}/comment`, {/* … */});
  return { content: [{ type: 'text', text: `Comment added: ${await res.text()}` }] };
});
```

Symptoms: the model guesses the parameter names; Claude Code asks for approval on every search, or someone allows the tool once and comments are posted without asking; after the token expired, Claude reported "Cannot read properties of undefined (reading 'map')"; a typo in `action` posted a comment that says "undefined"; and a comment on a mistyped key was reported as added. Rewrite it: a read tool `search_issues` and a write tool `add_comment` with zod input schemas and annotations, failures returned as tool results the model can act on, the Jira connection from environment variables, the stdio transport, and the configuration to use it from Claude Code and Claude Desktop. Explain what changes for a remote deployment over Streamable HTTP.

## What gets assessed

- Tool design: one tool per action, reads apart from writes, descriptions that say when to use each tool, and input schemas the SDK validates before any handler runs.
- Annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`): what each means, what clients do with them, and why they are hints, not security.
- Errors as results: `isError: true` with text that says what happened and what to do, and a server that keeps answering after a failure.
- The stdio contract: stdout carries the protocol only, logs go to stderr, the configuration is validated at startup, and secrets never reach a result or a log line.
- Wiring and deployment: `.mcp.json` for Claude Code, the Claude Desktop configuration, and Streamable HTTP for a shared server.

## How to approach it, step by step

1. Connect a real MCP client to the flawed server in a test (the SDK's in-memory transport) and call `listTools()`: that is everything the model knows about the tool.
2. Split the tool by effect: `search_issues` reads, `add_comment` writes. Write each input as a zod shape with limits and a `.describe()` per field.
3. Annotate both tools and write descriptions that say what the tool returns, when to use it and what it cannot do.
4. Put Jira behind a small client: Basic auth, a timeout per request, responses validated with zod, a typed error with the status and Jira's messages.
5. Wrap every handler so that any failure becomes `{ isError: true }` with a message chosen by status.
6. Validate the environment at startup and write the stdio entry point with the logger on stderr.
7. Test through the client: listing, a search against a fake Jira (msw), invalid input, Jira errors, and the server answering after a failure. Then start it once as a child process over stdio.
8. Register it in Claude Code and ask it about an issue.

## Solution explained

[`server.ts`](./server.ts) builds the server and its two tools, [`jira-client.ts`](./jira-client.ts) talks to Jira, [`config.ts`](./config.ts) reads the environment, [`stdio.ts`](./stdio.ts) is the entry point clients start, and [`server.problem.ts`](./server.problem.ts) is the flawed version. [`fake-jira.ts`](./fake-jira.ts) holds the msw handlers that [`server.test.ts`](./server.test.ts) and [`jira-client.test.ts`](./jira-client.test.ts) run against; [`stdio.test.ts`](./stdio.test.ts) starts the real entry point as a child process.

**What the model sees.** `tools/list` returns, for each tool, its name, title, description, input schema and annotations, and that is all the model knows before calling it. `z.any()` publishes `{ "type": "object", "properties": {} }`: no parameter names, so the model guesses `action`, `jql` and `issueKey`. `registerTool` takes zod shapes instead, and the SDK publishes them as JSON Schema with the pattern, limits, default and description of every field:

```ts
const addCommentInput = {
  issueKey: z.string().regex(ISSUE_KEY_PATTERN, 'expected a Jira issue key such as PLAT-101').describe('Issue key'),
  body: z.string().trim().min(1).max(5_000).describe('Comment text; a blank line starts a new paragraph'),
};
```

**Validation happens before the handler.** The SDK parses every call's arguments with that schema and applies defaults (`maxResults` becomes 10 when omitted). Invalid arguments never reach the handler; the client gets a tool result with `isError: true` that names each field, which the test asserts word for word:

```text
MCP error -32602: Input validation error: Invalid arguments for tool add_comment: expected a Jira issue key such as PLAT-101 at issueKey
Too small: expected string to have >=1 characters at body
```

So an empty comment or a key like `plat 104` costs nothing and posts nothing; the flawed server posted "undefined".

**One tool per effect, annotated.** Reads and writes need different treatment by the client, so they are different tools:

| Annotation        | `search_issues` | `add_comment` | Meaning (default when omitted)                                                                       |
| ----------------- | --------------- | ------------- | ---------------------------------------------------------------------------------------------------- |
| `readOnlyHint`    | `true`          | `false`       | Does not modify its environment (`false`). Claude Code runs read-only calls in parallel.             |
| `destructiveHint` | —               | `false`       | Only for writes: may destroy or overwrite (`true`). A comment is additive.                           |
| `idempotentHint`  | —               | `false`       | Only for writes: repeating the same call has no extra effect (`false`). A second call duplicates it. |
| `openWorldHint`   | `true`          | `true`        | Talks to an open, external system (`true`), here Jira.                                               |

Clients use them for the user experience: which calls need approval, which can run in parallel, and which can be repeated safely (over HTTP, Claude Code repeats a call that was pending when the connection dropped only for tools marked read-only or idempotent). They are hints: the MCP schema says clients should never base tool-use decisions on annotations from untrusted servers. The real control is the Jira account's permissions.

**Failures are results the model can act on.** MCP has two kinds of errors: protocol errors (JSON-RPC errors such as an unknown method) and tool execution errors, a normal result with `isError: true`. Only the second kind reaches the model as information: Claude Code hands the result's text to Claude as the tool's error message. The SDK's `McpServer` already turns an exception thrown in a handler into such a result, so the flawed server does not crash; but its text is the exception's message, and "Cannot read properties of undefined" tells the model nothing. The solution decides the text. `run()` in [`server.ts`](./server.ts) wraps every handler, logs the failure with its stack to stderr, and answers with [`describeFailure()`](./server.ts):

| Failure               | What the model reads                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------- |
| 400 (invalid JQL)     | "Jira rejected the request as invalid (400). Jira says: … Correct the input and try again." |
| 401                   | The credentials were rejected and a person must fix the configuration; never the token.     |
| 403, 404              | Not allowed, or not found, with Jira's explanation.                                         |
| 429                   | Rate limited: wait `Retry-After` seconds.                                                   |
| 5xx, timeout, network | Jira is unavailable or slow: try again later.                                               |
| anything else         | "Unexpected error in the Jira MCP server. The details are in its logs."                     |

Jira's own messages are passed on because they are written for the caller (an invalid JQL names the field); internal details are not. Every write checks the status: the flawed `add_comment` returned `Comment added: {"errorMessages":["Issue does not exist…"]}` without `isError`, and the model told the user the comment was posted. The tests prove each case, and that after a Jira 500 the next call succeeds.

**Results sized for a model.** `search_issues` returns the flat issue view (key, summary, status, assignee, priority, type, last update), asks Jira only for those fields, caps `maxResults` at 50 and adds `moreResults` so the model narrows the JQL instead of paging through everything. Claude Code saves a successful text result over 50,000 characters to a file instead of putting it in the conversation, and keeps only the start and end of error text over about 11,000 characters.

**Configuration and secrets.** [`loadJiraConfig()`](./config.ts) validates `JIRA_BASE_URL` (https only), `JIRA_EMAIL`, `JIRA_API_TOKEN` and `JIRA_TIMEOUT_MS` once, at startup, and lists every problem; zod names the variables, never their values. The client sends `Basic base64(email:apiToken)` and gives each request a 10 s timeout: Claude Code's own limit on a tool call (`MCP_TOOL_TIMEOUT`) is about 28 hours by default, so without it a stuck request holds the conversation. An API token acts with all the permissions of its account, so use a dedicated account that can only browse and comment on the projects involved. The logger redacts `authorization` and `apiToken` fields as a second line of defence.

**The stdio contract.** Over stdio the client starts the server as a child process and the two exchange JSON-RPC messages over stdin and stdout, so stdout must carry nothing else: one `console.log` corrupts the channel. [`stdio.ts`](./stdio.ts) creates the logger on file descriptor 2 (`pino.destination(2)`), loads the configuration, connects `StdioServerTransport`, and on an invalid configuration logs the reason and exits with code 1 before the client lists any tool. [`stdio.test.ts`](./stdio.test.ts) starts it exactly as a client would, from another working directory and with only the variables a client passes, lists the tools with no protocol error, and checks that the logs are on stderr; a second test checks exit code 1 and an empty stdout without `JIRA_API_TOKEN`.

**Connecting it to Claude Code.** A project-scoped `.mcp.json` at the root of the project (here the `applied-ai` folder) can be committed, because the secrets stay in each person's environment:

```json
{
  "mcpServers": {
    "jira-katas": {
      "type": "stdio",
      "command": "node",
      "args": [
        "${CLAUDE_PROJECT_DIR:-.}/node_modules/tsx/dist/cli.mjs",
        "${CLAUDE_PROJECT_DIR:-.}/src/exercises/mcp-server/stdio.ts"
      ],
      "env": {
        "JIRA_BASE_URL": "${JIRA_BASE_URL}",
        "JIRA_EMAIL": "${JIRA_EMAIL}",
        "JIRA_API_TOKEN": "${JIRA_API_TOKEN}"
      }
    }
  }
}
```

Claude Code expands `${VAR}` and `${VAR:-default}` in `command`, `args`, `env`, `url` and `headers`; an unset variable without a default stays as literal text and `claude mcp list` warns about it. `CLAUDE_PROJECT_DIR` is the project root (a project entry must give it a default), so the paths do not depend on the working directory. Running `node` with tsx's CLI by absolute path is the same command `stdio.test.ts` runs, with no `npx` and no shell in between. `claude mcp add --scope project` writes the same kind of entry; `claude mcp list` shows whether it connected, and `/mcp` inside a session shows its tool count.

**Connecting it to Claude Desktop.** Add the same `mcpServers` entry to `claude_desktop_config.json` (`%APPDATA%\Claude\` on Windows, `~/Library/Application Support/Claude/` on macOS) with absolute paths in `args` and the values in `env`. That file lives in your user profile, never in a repository.

**Remote: Streamable HTTP.** To share one server with a team, only the transport changes: `createJiraMcpServer()` is connected to a `StreamableHTTPServerTransport` (`@modelcontextprotocol/sdk/server/streamableHttp.js`) behind one HTTP endpoint, where clients `POST` requests and may open a `GET` stream for server messages. It takes `sessionIdGenerator` (stateful sessions, or `undefined` for stateless) and, when it listens locally, `enableDnsRebindingProtection` with `allowedHosts` and `allowedOrigins`. Authentication changes more than the code: the MCP server becomes an OAuth protected resource that clients authenticate to, and each user's Jira access should come from OAuth 2.0 (3LO) with scopes such as `read:jira-work` and `write:jira-work` instead of one shared API token, so comments are attributed to the person who asked. Claude Code connects with `claude mcp add --transport http <name> <url>`.

**How it is proven.** `server.test.ts` connects the SDK's `Client` to each server through `InMemoryTransport.createLinkedPair()` and fakes Jira with msw: the tools and their annotations are listed, a search returns compact issues, the default applies, a comment is posted, invalid input is rejected without calling Jira, a 400, 401, 404 and 500 each give their message (the token never appears), and the server answers after a failure. The flawed server's tests show an empty schema with no annotations, the "undefined" comment, the `TypeError` text and the missing issue reported as commented. `jira-client.test.ts` covers the request shape, ADF bodies, error parsing, `Retry-After`, the timeout and an unexpected response shape; `config.test.ts` the environment; `stdio.test.ts` the real process.

**Real mode (optional).** Copy `.env.example` to `.env` with a real site, account and API token and run `npm run mcp`; it waits for a client on stdin. The MCP Inspector (`npx @modelcontextprotocol/inspector`) gives a UI to call the tools by hand.

## Common mistakes

| Symptom                                                   | Cause                                                                                                    |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| The client reports parse errors or drops the server       | Something writes to stdout in a stdio server: a `console.log`, a banner, a logger on its default stream. |
| The model calls the tool with wrong parameter names       | An empty or vague input schema (`z.any()`, no `.describe()`), so `tools/list` publishes no parameters.   |
| An approval prompt on every search, or none for writes    | Reads and writes in the same tool, or no annotations: the client cannot tell them apart.                 |
| "Cannot read properties of undefined" in the conversation | The HTTP status is not checked, and the exception's message becomes the result text.                     |
| A failed write is reported as done                        | The response status of the `POST` is ignored and `isError` is never set.                                 |
| A tool call hangs for minutes                             | No timeout on the Jira request; the client's own tool timeout is far longer.                             |
| Jira answers 401 although the token is set in `.mcp.json` | `${JIRA_API_TOKEN}` was not set in the environment that started Claude Code, so it was sent literally.   |
| The token shows up in a transcript or a log               | Error text built from the request or the configuration, or a logger without redaction.                   |
| A comment is posted twice after a reconnect               | A write marked `idempotentHint: true` although repeating it repeats the effect.                          |

## Practice

Give `search_issues` an `outputSchema` (a zod shape for `issues` and `moreResults`) and return `structuredContent` next to the text, then add a test that the client receives the structured result and that a result not matching the schema is rejected.
