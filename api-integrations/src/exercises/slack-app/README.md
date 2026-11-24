# Slack app: signed slash command with a deferred reply

## Statement

A Slack slash command, `/open-issues PLAT`, answers with the open issues of a Jira project. The handler builds the report and returns it:

```ts
const form = new URLSearchParams(body);
const report = await buildReport(form.get('text')); // a Jira search: 1 to 6 seconds
res.end(JSON.stringify(reportMessage(report, form.get('user_id'))));
```

Symptoms: on big projects users get an `operation_timeout` error in Slack and never see the report. A security review also points out that anyone who finds the URL can run the command as any user. Rewrite the handler so that it verifies that requests come from Slack, acknowledges within Slack's 3-second limit, and delivers the report afterwards as a Block Kit message.

## What gets assessed

- Verifying `X-Slack-Signature` by hand: HMAC-SHA256 over `v0:{timestamp}:{raw body}`, a 5-minute window, constant-time comparison.
- Why the **raw body** matters, and why it must be read before any parsing.
- The acknowledge-then-work pattern: a 200 within 3 seconds, the slow part in a queue, the result through `response_url`.
- Block Kit basics and escaping user text in `mrkdwn`.
- How Bolt does the same, and what changes on Lambda (`processBeforeResponse`).

## How to approach it, step by step

1. Reproduce the timeout: a fake report that never finishes, and a test that shows the flawed handler has not answered after 200 ms.
2. Write `verifySlackSignature()` as a pure function and test it with Slack's documented example (secret, timestamp, body and expected signature).
3. In the handler, read the body as bytes, verify, and only then parse the form and validate it with zod.
4. Replace "build and return" with "enqueue and acknowledge": the handler gets an `enqueue(job)` function and answers an ephemeral "Building…" at once.
5. Write the worker: build the report, turn it into Block Kit, POST it to `response_url`; on failure, tell the user there.
6. Test the whole flow over real HTTP: the acknowledgement arrives while the report is still pending, and the Block Kit message arrives after.

## Solution explained

[`verify-slack-signature.ts`](./verify-slack-signature.ts) verifies requests, [`slash-command-handler.ts`](./slash-command-handler.ts) acknowledges, [`report-worker.ts`](./report-worker.ts) does the slow part, [`report-message.ts`](./report-message.ts) builds the messages, and [`slash-command-handler.problem.ts`](./slash-command-handler.problem.ts) is the flawed version. [`slash-command-handler.test.ts`](./slash-command-handler.test.ts) runs both handlers on a real local `node:http` server; [`verify-slack-signature.test.ts`](./verify-slack-signature.test.ts) and [`report-message.test.ts`](./report-message.test.ts) cover the pure parts.

**The signature.** Slack signs every request with the app's Signing Secret:

```ts
const hmac = createHmac('sha256', signingSecret).update(`v0:${timestampHeader}:`).update(rawBody).digest('hex');
return safeEqual(`v0=${hmac}`, signatureHeader) ? { ok: true } : { ok: false, reason: 'bad-signature' };
```

- **The timestamp is part of the signed string**, so it can't be changed without the secret. Rejecting anything more than 5 minutes away from now (either direction) stops replays: a captured request is useless after five minutes.
- **Constant-time comparison.** `===` stops at the first different character, so response times leak how much of a forged signature is right. [`safeEqual()`](../../lib/timing-safe.ts) uses `timingSafeEqual`, after checking the lengths (it throws on different lengths, and the length of a hex SHA-256 is no secret).
- **The test uses Slack's own worked example** from the documentation, so the function is checked against the source of truth, not against itself.

**Why the raw body.** The signature covers the bytes Slack sent. A framework that parses the form first and lets you re-serialize it produces the same fields with different bytes (another order, another encoding), and the signature fails, or worse, the code ends up verifying something other than what it acts on. A test re-serializes the documented body with its fields sorted and shows the signature no longer matches. In Express this means `express.raw()` (or the `verify` hook of the body parser) on this route; in Lambda, the event's `body` (base64-decoded when `isBase64Encoded`).

**Verify, then validate.** A valid signature means "Slack sent this", not "this is well formed". The handler validates the form with zod, and pins `response_url` to `https://hooks.slack.com`: the worker will POST to that URL, so accepting any URL from a body would let a leaked secret turn the app into a request forwarder (SSRF). A test sends a signed request with an internal URL and gets a 400.

**Acknowledge first, work later.** Slack waits 3 seconds for the HTTP response. The handler answers within milliseconds with an ephemeral message (`response_type: 'ephemeral'`, only the user sees it) and hands a job to `enqueue`. The test proves it with a report that stays pending: the 200 arrives, `buildReport` has been called, and nothing has been posted to `response_url` yet. Only when the test resolves the report does the Block Kit message arrive. The flawed handler, with the same pending report, has not answered after 200 ms, so with a real Jira search Slack would show `operation_timeout`.

**The worker and `response_url`.** The slash command payload carries a `response_url` that accepts JSON messages (`text`, `blocks`, `response_type`, `replace_original`, `thread_ts`) up to 5 times within 30 minutes, with no bot token needed. The worker posts the report there, and if the report fails it posts "Could not build the report…" and rethrows so the error is logged (a test covers it). In this kata the queue is an in-memory runner ([`background-tasks.ts`](../../lib/background-tasks.ts)); in production it is a durable queue such as **SQS with a Lambda worker**, because in-memory work dies with the process and is not retried.

**Block Kit.** [`reportMessage()`](./report-message.ts) returns a `header` (plain text), a `section` (mrkdwn list) and a `context` line mentioning the user with `<@USER_ID>`. The top-level `text` is still set: it is the fallback for notifications and screen readers. User data (issue summaries) is escaped: in mrkdwn `&`, `<` and `>` are control characters, and a summary like `Fix <!channel> alerts` would otherwise notify the whole channel.

**How Bolt does it.** Bolt for JavaScript verifies the signature by default (`signatureVerification: true`) and exposes the same check as `verifySlackRequest`. In a listener, `ack()` is the acknowledgement:

```ts
// Sketch, not compiled in this kata.
const app = new App({ token, signingSecret, processBeforeResponse: true });
app.command('/open-issues', async ({ command, ack }) => {
  await ack('Building the open issues report…');
  await queue.send({ projectKey: command.text, responseUrl: command.response_url }); // fast: just enqueue
});
```

By default (`processBeforeResponse: false`) Bolt sends the HTTP response as soon as `ack()` is called and the listener keeps running. On a FaaS platform such as Lambda, the environment can be frozen as soon as the response is returned, so work after the response may never run. `processBeforeResponse: true` makes Bolt respond only after the listener finishes, which is right for Lambda as long as the listener stays fast: it acknowledges and enqueues, and the heavy work runs in another function fed by the queue.

## Common mistakes

| Symptom                                                    | Cause                                                                                                                 |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `operation_timeout` in Slack, but the logs show success    | The slow work happens before the HTTP response; Slack stopped waiting at 3 seconds.                                   |
| Every signature fails in production but passes in tests    | The body is parsed by middleware before verification, and the code signs a re-serialized body instead of the raw one. |
| `RangeError: Input buffers must have the same byte length` | `timingSafeEqual` called without checking the lengths first.                                                          |
| An old request is accepted again                           | The timestamp is not checked, or it is checked but not included in the signed string.                                 |
| The work runs locally but not on Lambda                    | Work started after returning the response; the environment is frozen. Use a queue, or Bolt's `processBeforeResponse`. |
| A summary pings the whole channel                          | User text in mrkdwn without escaping `&`, `<` and `>`.                                                                |
| The user sees "Building…" forever                          | The worker fails silently; it should post an error to `response_url` and log the failure.                             |

## Practice

Add an interactive button to the report ("Show in channel") and a handler for its `block_actions` payload, verified with the same function, that re-posts the report with `response_type: 'in_channel'` through the payload's `response_url`.
