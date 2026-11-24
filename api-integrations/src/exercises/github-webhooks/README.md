# GitHub webhooks: signature and idempotent deliveries

## Statement

A small GitHub integration comments a review checklist on every new pull request. Its webhook handler:

```ts
const payload = JSON.parse(body);
if (req.headers['x-github-event'] === 'pull_request' && payload.action === 'opened') {
  await octokit.rest.issues.createComment({ owner, repo, issue_number: payload.number, body: checklist });
}
res.writeHead(200).end('ok');
```

Symptoms: some pull requests get the checklist two or three times, always after a delivery was redelivered: by hand from the webhook settings, or by the script that redelivers failed deliveries after a slow response. A security review adds that anyone who finds the URL can make the app comment on any repository it can reach. Make the handler verify `X-Hub-Signature-256`, process each delivery once whatever GitHub resends, and answer quickly.

## What gets assessed

- Verifying `X-Hub-Signature-256` over the raw body, in constant time, checked against GitHub's test vector.
- Idempotency keyed by `X-GitHub-Delivery`, behind a port, with an atomic "claim".
- Choosing the status codes: 401, 400, 200 for a duplicate, 202 for accepted.
- Answering within GitHub's 10 seconds and processing in the background, including what happens when processing fails.
- Calling the REST API with Octokit (`issues.createComment` on a pull request).

## How to approach it, step by step

1. Reproduce both problems over real HTTP with msw standing in for `api.github.com`: an unsigned request that still comments, and the same delivery sent twice that comments twice.
2. Write `verifyGithubSignature(secret, rawBody, header)` and test it with the secret, payload and signature from GitHub's documentation.
3. Define the port `DeliveryStore` with `claim(id)` (atomic, returns false if already claimed) and `release(id)`, and an in-memory adapter.
4. In the handler: raw body → signature (401) → headers and JSON (400) → `claim` (200 "duplicate") → background processing → 202.
5. If processing fails, `release` the id so that a manual redelivery can process it again.
6. Write the processor: ignore other events and actions, validate the payload with zod, comment with Octokit.

## Solution explained

[`verify-github-signature.ts`](./verify-github-signature.ts) verifies, [`delivery-store.ts`](./delivery-store.ts) is the idempotency port and its in-memory adapter, [`webhook-handler.ts`](./webhook-handler.ts) is the HTTP handler, [`pull-request-opened.ts`](./pull-request-opened.ts) the processor, and [`webhook-handler.problem.ts`](./webhook-handler.problem.ts) the flawed version. [`webhook-handler.test.ts`](./webhook-handler.test.ts) runs both handlers on a local `node:http` server, with msw as `api.github.com`; [`verify-github-signature.test.ts`](./verify-github-signature.test.ts) and [`delivery-store.test.ts`](./delivery-store.test.ts) cover the pieces.

**The signature.** GitHub sends `X-Hub-Signature-256: sha256=<hex>`, the HMAC-SHA256 of the raw body keyed with the webhook secret:

```ts
if (!signatureHeader?.startsWith('sha256=')) return false;
const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
return safeEqual(expected, signatureHeader);
```

The test uses GitHub's documented example (secret `It's a Secret to Everybody`, payload `Hello, World!`). As with Slack, the bytes must be the ones received: re-serializing parsed JSON changes them. The legacy SHA-1 header (`X-Hub-Signature`) is not accepted. In an app that uses the Octokit stack, `verify(secret, payload, signature)` from `@octokit/webhooks-methods` (or `webhooks.verify()` / `verifyAndReceive()` from `@octokit/webhooks`) does the same; writing it by hand once shows what they do.

**No timestamp, so replays are on you.** Unlike Slack and Stripe, GitHub signs only the body. A captured delivery is valid forever. Remembering delivery ids, which idempotency needs anyway, is also what stops a replay: the second copy is a duplicate.

**Idempotency by delivery id.** Every delivery has a unique `X-GitHub-Delivery` (a GUID), and a redelivery keeps the same one. The handler asks the store to `claim` it before doing anything:

- `claim` returns true the first time and false after: a duplicate gets a **200** (a 2XX, so the delivery shows as successful and is not redelivered again) and has no effect.
- The claim must be **atomic**. "Read, then insert if absent" lets two simultaneous copies both pass. In memory, a check and an add with no `await` between them are one step (a test fires ten claims at once and exactly one wins). In production the store is a database: DynamoDB `PutItem` with `ConditionExpression: 'attribute_not_exists(deliveryId)'` (a `ConditionalCheckFailedException` means duplicate, and a TTL attribute expires old ids), or Postgres `INSERT … ON CONFLICT DO NOTHING` on a unique key (zero rows inserted means duplicate).
- The store is a **port** (an interface the handler depends on), so changing the adapter changes nothing in the handler or its tests.

**Fast answer, background work.** GitHub expects a 2XX within 10 seconds and treats a slower answer as a failed delivery. The handler answers **202 Accepted** after the claim and runs the processor in the background ([`background-tasks.ts`](../../lib/background-tasks.ts) here; a queue in production, so that work survives a restart). If processing fails, the handler **releases** the id: the delivery shows as accepted in GitHub, and pressing "Redeliver" will process it again instead of being answered "duplicate". A test makes the comments API fail once with a 502, redelivers, and gets exactly one comment. The trade-off: a failure after the comment was created (but before the end of processing) would comment twice on redelivery. Where that matters, make the effect itself idempotent, for example by looking for a hidden marker in existing comments before commenting.

**Status codes.** 401 for a bad or missing signature (and no other detail), 400 for a missing `X-GitHub-Delivery` / `X-GitHub-Event` or a body that is not JSON, 200 `duplicate`, 202 `accepted`, 413 for an oversized body, 500 for anything unexpected.

**The processor and Octokit.** A webhook subscribed to `pull_request` also receives `closed`, `synchronize`, `labeled` and more, and every webhook receives a `ping` when it is created: the processor ignores everything but `pull_request` + `opened`, and validates only the fields it uses with zod. Pull requests are issues for the comments API, so the call is `octokit.rest.issues.createComment({ owner, repo, issue_number, body })`, which is `POST /repos/{owner}/{repo}/issues/{issue_number}/comments`. Octokit uses `fetch`, so msw intercepts it like any other request. In production the token would be a GitHub App installation token rather than a personal one.

## Common mistakes

| Symptom                                                    | Cause                                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Duplicate comments after "Redeliver"                       | No idempotency, or keyed on something other than `X-GitHub-Delivery`.                             |
| Duplicates still appear under load                         | The duplicate check is "read, then write": two copies of a delivery pass it together.             |
| Every signature fails, but the secret is right             | The body was parsed and re-serialized before verifying, or the SHA-1 header is used.              |
| GitHub marks deliveries as failed and they get redelivered | The work runs before the response and takes longer than 10 seconds.                               |
| A failed delivery can never be processed again             | The id stays claimed after the processing failed; release it on failure.                          |
| `TypeError` on `payload.pull_request` for some deliveries  | Other events (`ping`, `issues`) or actions reach the same handler and the payload is not checked. |
| A fake event makes the app comment on a repository         | The signature is not verified, so anyone can post to the endpoint.                                |

## Practice

Implement a `DeliveryStore` adapter for Postgres with `INSERT … ON CONFLICT DO NOTHING RETURNING delivery_id`, and run the same handler tests against it.
