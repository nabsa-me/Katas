import { z } from 'zod';
import sampleData from '../data/issues.json';

/** A Jira issue key: project key, a dash and a number (`PLAT-101`). */
export const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]+-\d+$/;

/**
 * The Jira Cloud REST shape of an issue, limited to the fields these katas request. The same schema parses the
 * fictional sample data and the responses of the (faked) Jira API: external data is never trusted.
 */
export const jiraIssueSchema = z.object({
  id: z.string(),
  key: z.string().regex(ISSUE_KEY_PATTERN),
  fields: z.object({
    summary: z.string(),
    description: z.string().nullable().optional(),
    status: z.object({ name: z.string() }),
    assignee: z.object({ accountId: z.string(), displayName: z.string() }).nullable(),
    priority: z.object({ name: z.string() }).nullable().optional(),
    issuetype: z.object({ name: z.string() }).optional(),
    labels: z.array(z.string()).optional(),
    updated: z.string(),
  }),
});

export type JiraIssue = z.infer<typeof jiraIssueSchema>;

/** The flat view of an issue that tools hand to a model: short, explicit, no nested Jira structure. */
export interface IssueView {
  key: string;
  summary: string;
  status: string;
  assignee: string | null;
  priority: string | null;
  type: string | null;
  updated: string;
  description?: string;
}

/** The fictional issues in `src/data/issues.json`, validated once when the module loads. */
export const sampleIssues: readonly JiraIssue[] = z.array(jiraIssueSchema).parse(sampleData);

export function toIssueView(issue: JiraIssue, { withDescription = false } = {}): IssueView {
  const { fields } = issue;
  return {
    key: issue.key,
    summary: fields.summary,
    status: fields.status.name,
    assignee: fields.assignee?.displayName ?? null,
    priority: fields.priority?.name ?? null,
    type: fields.issuetype?.name ?? null,
    updated: fields.updated,
    ...(withDescription && fields.description ? { description: fields.description } : {}),
  };
}

/** Looks an issue up by key in the sample data; `undefined` when there is no such issue. */
export function findIssue(key: string): JiraIssue | undefined {
  return sampleIssues.find((issue) => issue.key === key);
}
