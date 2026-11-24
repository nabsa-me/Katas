import type { RequestListener } from 'node:http';
import type { Octokit } from '@octokit/rest';
import { reviewChecklist } from './pull-request-opened';

/**
 * Flawed: comments a checklist on new pull requests. Correct on the happy path, which is all a demo shows.
 */
export function createWebhookHandler(octokit: Octokit): RequestListener {
  return async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;

    // BUG: X-Hub-Signature-256 is never checked. Anyone who finds the URL can post a fake event and make the app
    // comment, with its token, on any repository it has access to.
    const payload = JSON.parse(body);

    if (req.headers['x-github-event'] === 'pull_request' && payload.action === 'opened') {
      // BUG: no idempotency. A redelivery (by hand, or by a script retrying failed ones) has the same
      // X-GitHub-Delivery and comments again. The work also runs before the response, which makes timeouts, and
      // so redeliveries, likelier.
      await octokit.rest.issues.createComment({
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        issue_number: payload.number,
        body: reviewChecklist(payload.pull_request.user.login),
      });
    }
    res.writeHead(200).end('ok');
  };
}
