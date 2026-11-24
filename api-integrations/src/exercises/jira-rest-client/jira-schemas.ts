import { z } from 'zod';

/** Fields requested in every search. The issue schema below describes exactly these, nothing else. */
export const ISSUE_FIELDS = ['summary', 'status', 'assignee', 'updated'] as const;

export const issueSchema = z.object({
  id: z.string(),
  key: z.string(),
  fields: z.object({
    summary: z.string(),
    status: z.object({ name: z.string() }),
    // Unassigned issues come with `assignee: null`, not without the field.
    assignee: z.object({ displayName: z.string() }).nullable(),
    updated: z.string(),
  }),
});

export type JiraIssue = z.infer<typeof issueSchema>;

/**
 * A page of `POST /rest/api/3/search/jql`. There is no `startAt` and no `total`: the next page is reached with the
 * opaque `nextPageToken`, which is absent or null on the last page. `isLast` says the same thing explicitly.
 */
export const searchPageSchema = z.object({
  issues: z.array(issueSchema),
  nextPageToken: z.string().nullish(),
  isLast: z.boolean().optional(),
});

export const commentSchema = z.object({
  id: z.string(),
  author: z.object({ displayName: z.string() }).optional(),
  created: z.string(),
  // Atlassian Document Format (a JSON tree) in API v3; kept opaque because this client only moves it around.
  body: z.unknown(),
});

export type JiraComment = z.infer<typeof commentSchema>;

/** `GET /rest/api/3/issue/{key}/comment` still uses offset pagination: `startAt`, `maxResults` and `total`. */
export const commentPageSchema = z.object({
  comments: z.array(commentSchema),
  startAt: z.number(),
  maxResults: z.number(),
  total: z.number(),
});

/** Jira's error body: general messages plus messages per field. */
export const errorCollectionSchema = z.object({
  errorMessages: z.array(z.string()).optional(),
  errors: z.record(z.string(), z.string()).optional(),
});
