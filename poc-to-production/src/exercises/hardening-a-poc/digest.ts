import type { ChatMessage, ChatNotifier, IssueSource, OpenIssue } from './ports';

/** Beyond this, a long list hides the rest of the digest: the message says how many more there are. */
export const MAX_ISSUES_PER_ASSIGNEE = 5;

export interface AssigneeGroup {
  /** `null` groups the unassigned issues. */
  assignee: string | null;
  issues: OpenIssue[];
}

export interface DigestResult {
  issueCount: number;
  assigneeCount: number;
  messageId: string;
}

/**
 * Slack reads `&`, `<` and `>` as control characters (`<!channel>`, `<@U123>`, `<url|text>`), so text from Jira
 * must have exactly those three replaced by entities. Otherwise a summary can ping the whole channel.
 */
export function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Groups by assignee, alphabetically, with the unassigned issues last. Keeps the source order inside a group. */
export function groupByAssignee(issues: readonly OpenIssue[]): AssigneeGroup[] {
  const groups = new Map<string | null, OpenIssue[]>();
  for (const issue of issues) {
    const group = groups.get(issue.assignee) ?? [];
    group.push(issue);
    groups.set(issue.assignee, group);
  }
  return [...groups]
    .map(([assignee, grouped]) => ({ assignee, issues: grouped }))
    .sort((a, b) => {
      if (a.assignee === null || b.assignee === null) return a.assignee === null ? 1 : -1;
      return a.assignee.localeCompare(b.assignee);
    });
}

/** The digest as Slack `mrkdwn`. Pure: same issues and date, same text. */
export function formatDigest(issues: readonly OpenIssue[], projectKey: string, today: Date): ChatMessage {
  const title = `*Open issues in ${projectKey} on ${today.toISOString().slice(0, 10)}*`;
  if (issues.length === 0) return { text: `${title}: none. Nothing to review today.` };

  const lines = [`${title}: ${issues.length}`];
  for (const { assignee, issues: grouped } of groupByAssignee(issues)) {
    lines.push('', `*${assignee === null ? 'Unassigned' : escapeMrkdwn(assignee)}* (${grouped.length})`);
    for (const issue of grouped.slice(0, MAX_ISSUES_PER_ASSIGNEE)) {
      lines.push(`• <${issue.url}|${issue.key}> ${escapeMrkdwn(issue.summary)}`);
    }
    const hidden = grouped.length - MAX_ISSUES_PER_ASSIGNEE;
    if (hidden > 0) lines.push(`• …and ${hidden} more`);
  }
  return { text: lines.join('\n') };
}

export interface DailyDigestDependencies {
  source: IssueSource;
  chat: ChatNotifier;
  projectKey: string;
  today: Date;
}

/**
 * The use case: read the open issues, format them and post them. It only knows the ports, so the unit tests run
 * it with two in-memory objects, and swapping Jira or Slack for another tool does not touch it.
 * It posts even when there is nothing open: a missing digest then always means the bot failed.
 */
export async function postDailyDigest({
  source,
  chat,
  projectKey,
  today,
}: DailyDigestDependencies): Promise<DigestResult> {
  const issues = await source.listOpenIssues();
  const { messageId } = await chat.post(formatDigest(issues, projectKey, today));
  const assignees = new Set(issues.flatMap((issue) => (issue.assignee === null ? [] : [issue.assignee])));
  return { issueCount: issues.length, assigneeCount: assignees.size, messageId };
}
