/** What the slow part of the command produces: the open issues of a project. */
export interface IssueReport {
  projectKey: string;
  issues: { key: string; summary: string; status: string }[];
}

/** Message sent to `response_url`: a fallback `text` for notifications plus the Block Kit layout. */
export interface SlackMessage {
  response_type: 'ephemeral' | 'in_channel';
  text: string;
  blocks?: unknown[];
}

/** Keeps the section well inside Block Kit's text limits; the rest is summarized as "and N more". */
export const MAX_LISTED_ISSUES = 10;

/**
 * Escapes the three characters Slack's mrkdwn treats as control characters. Without it, an issue summary like
 * "Fix <!channel> alerts" would notify the whole channel, and `<https://…|text>` would render as a link.
 */
export function escapeMrkdwn(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** The report as a Block Kit message, visible only to the user who ran the command. */
export function reportMessage(report: IssueReport, requestedBy: string): SlackMessage {
  const { projectKey, issues } = report;
  const title = `Open issues in ${projectKey}: ${issues.length}`;
  const lines = issues
    .slice(0, MAX_LISTED_ISSUES)
    .map((issue) => `• *${escapeMrkdwn(issue.key)}* ${escapeMrkdwn(issue.summary)} · _${escapeMrkdwn(issue.status)}_`);
  if (issues.length > MAX_LISTED_ISSUES) lines.push(`…and ${issues.length - MAX_LISTED_ISSUES} more`);

  return {
    response_type: 'ephemeral',
    text: title,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: title } },
      { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') || 'Nothing open. 🎉' } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `Requested by <@${requestedBy}>` }] },
    ],
  };
}

/** Plain ephemeral text: the immediate acknowledgement, usage hints and errors. */
export function ephemeral(text: string): SlackMessage {
  return { response_type: 'ephemeral', text };
}
