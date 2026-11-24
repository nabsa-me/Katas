import type { RequestListener } from 'node:http';
import { reportMessage, type IssueReport } from './report-message';

/**
 * Flawed: answers the slash command with the finished report. It works in a demo where the report takes 200 ms,
 * and fails in production where the Jira search takes seconds. The message builder is fine; the flow is not.
 */
export function createSlashCommandHandler(buildReport: (projectKey: string) => Promise<IssueReport>): RequestListener {
  return async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const form = new URLSearchParams(body);

    // BUG: no signature check. Anyone who finds the URL can run the command, posing as any user and channel.
    const projectKey = (form.get('text') ?? '').trim().toUpperCase();

    // BUG: the slow work runs before answering. Slack gives up after 3 seconds and shows the user an error
    // (operation_timeout), even though the report is still being built and nobody will see it.
    const report = await buildReport(projectKey);
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify(reportMessage(report, form.get('user_id') ?? '')));
  };
}
