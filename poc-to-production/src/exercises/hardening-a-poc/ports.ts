/** An open issue as the digest needs it: no Jira field names, no HTTP. */
export interface OpenIssue {
  key: string;
  summary: string;
  /** Display name, or `null` when nobody is assigned. */
  assignee: string | null;
  url: string;
}

/** A message in Slack's `mrkdwn`: the text is already escaped and formatted. */
export interface ChatMessage {
  text: string;
}

/** Driven port: where the open issues come from (Jira in production, an array in unit tests). */
export interface IssueSource {
  listOpenIssues(): Promise<OpenIssue[]>;
}

/** Driven port: where the digest goes (a Slack channel in production). Returns the posted message's id. */
export interface ChatNotifier {
  post(message: ChatMessage): Promise<{ messageId: string }>;
}
