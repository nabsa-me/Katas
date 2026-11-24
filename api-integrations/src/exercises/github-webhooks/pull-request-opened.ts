import type { Octokit } from '@octokit/rest';
import { z } from 'zod';

/** The few fields of a `pull_request` event this app uses; GitHub sends many more. */
const pullRequestEventSchema = z.object({
  action: z.string(),
  number: z.number().int().positive(),
  pull_request: z.object({ user: z.object({ login: z.string() }) }),
  repository: z.object({ name: z.string(), owner: z.object({ login: z.string() }) }),
});

export interface WebhookEvent {
  /** `X-GitHub-Event`, such as `pull_request`. */
  name: string;
  /** `X-GitHub-Delivery`: unique per delivery, and the same on a redelivery. */
  deliveryId: string;
  payload: unknown;
}

export function reviewChecklist(author: string): string {
  return [
    `Thanks @${author}! Before asking for review:`,
    '',
    '- [ ] Tests cover the change',
    '- [ ] Migrations, permissions or infrastructure touched? Say how to roll back',
    '- [ ] The description explains why, not only what',
  ].join('\n');
}

/**
 * Comments a review checklist on every newly opened pull request. Pull requests are issues for the comments
 * API, so the endpoint is `POST /repos/{owner}/{repo}/issues/{number}/comments`. Other events and actions are
 * ignored: a webhook subscribed to `pull_request` also receives `closed`, `synchronize`, `labeled`…
 */
export function createPullRequestOpenedProcessor(octokit: Octokit) {
  return async function processEvent(event: WebhookEvent): Promise<void> {
    if (event.name !== 'pull_request') return;
    const { action, number, pull_request, repository } = pullRequestEventSchema.parse(event.payload);
    if (action !== 'opened') return;

    await octokit.rest.issues.createComment({
      owner: repository.owner.login,
      repo: repository.name,
      issue_number: number,
      body: reviewChecklist(pull_request.user.login),
    });
  };
}
