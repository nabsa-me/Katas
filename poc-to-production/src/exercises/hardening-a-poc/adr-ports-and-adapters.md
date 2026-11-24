# ADR: Ports and adapters for the daily digest bot

- **Status:** Accepted
- **Date:** 2026-11-24

## Context

The daily digest bot started as a single-file proof of concept: it read open issues from Jira, grouped them by assignee and posted the text to Slack, all at module level. Taking it to production needs tests for the grouping and formatting rules, tests for the failure paths of both APIs (pagination, rate limits, timeouts, Slack's `ok: false`), and room for changes that are likely: another chat tool, another issue tracker, or a second output such as email.

With logic and I/O mixed, every test of a formatting rule needs both APIs faked, and every change of provider touches the rules.

## Decision

Split the bot into ports and adapters (hexagonal architecture), at the smallest size that solves the problem:

- **Domain and use case** ([`digest.ts`](./digest.ts)): pure functions for grouping, escaping and formatting, and `postDailyDigest`, which only knows the ports.
- **Two driven ports** ([`ports.ts`](./ports.ts)): `IssueSource.listOpenIssues()` and `ChatNotifier.post(message)`, expressed in domain terms (`OpenIssue`, `ChatMessage`), with no Jira or Slack field names.
- **One adapter per external API** ([`jira-issue-source.ts`](./jira-issue-source.ts), [`slack-notifier.ts`](./slack-notifier.ts)): authentication, pagination, response schemas, retries and error mapping live here.
- **A composition root** ([`main.ts`](./main.ts)): reads the configuration, builds the adapters with plain constructors and wires them to the use case. No dependency injection container.

## Consequences

- The domain is tested with plain objects as adapters: no HTTP and no `fetch` mocks in its tests.
- Each adapter is tested once against a fake of its API (msw), including the failure paths; the end-to-end test covers the wiring.
- Replacing Slack with another chat tool means a new `ChatNotifier` adapter and one line in `main.ts`.
- More files than the PoC (ten instead of one) and an indirection to follow when reading the code. For a bot this size it is the limit: no further layers, no generic repository abstractions.
- The ports return everything at once (`OpenIssue[]`). That is fine for a digest of open issues; a source with thousands of results would need a streaming port (an async iterator).

## Alternatives considered

- **Keep one file and mock `fetch` in the tests.** Fewer files, but every test of a formatting rule would set up both APIs, and the tests would break with any change to the HTTP calls.
- **Use the official SDKs (`@slack/web-api`, a Jira client) directly in the use case.** They bring their own retries and types, but the use case would depend on two vendor APIs, and the tests would mock SDK internals. They remain a valid choice _inside_ an adapter.
- **A full hexagonal setup with a DI container and a module per layer.** More structure than two dependencies justify.
