import { describe, expect, it } from 'vitest';
import { findIssue, ISSUE_KEY_PATTERN, jiraIssueSchema, sampleIssues, toIssueView } from './issues';

describe('sample issues', () => {
  it('parses every fictional issue with unique keys', () => {
    expect(sampleIssues.length).toBeGreaterThanOrEqual(12);
    expect(new Set(sampleIssues.map((issue) => issue.key)).size).toBe(sampleIssues.length);
  });

  it('finds an issue by key and returns undefined for an unknown key', () => {
    expect(findIssue('PLAT-104')?.fields.summary).toMatch(/Payments API/);
    expect(findIssue('PLAT-999')).toBeUndefined();
  });
});

describe('toIssueView', () => {
  it('flattens the Jira structure and keeps unassigned issues explicit', () => {
    expect(toIssueView(findIssue('PLAT-102')!)).toEqual({
      key: 'PLAT-102',
      summary: 'Add CSV export to the monthly usage report',
      status: 'To Do',
      assignee: null,
      priority: 'Medium',
      type: 'Story',
      updated: '2026-11-18T14:02:00.000+0000',
    });
  });

  it('adds the description only when asked', () => {
    const issue = findIssue('PLAT-101')!;
    expect(toIssueView(issue)).not.toHaveProperty('description');
    expect(toIssueView(issue, { withDescription: true }).description).toMatch(/504/);
  });
});

describe('jiraIssueSchema', () => {
  it('rejects data that does not look like a Jira issue', () => {
    expect(jiraIssueSchema.safeParse({ key: 'not a key', fields: {} }).success).toBe(false);
  });

  it('accepts project keys and rejects anything else', () => {
    expect(['PLAT-1', 'DATA2-45', 'A1_B-7'].every((key) => ISSUE_KEY_PATTERN.test(key))).toBe(true);
    expect(['plat-1', 'PLAT', 'PLAT-', '-1', 'PLAT-1; DROP'].some((key) => ISSUE_KEY_PATTERN.test(key))).toBe(false);
  });
});
