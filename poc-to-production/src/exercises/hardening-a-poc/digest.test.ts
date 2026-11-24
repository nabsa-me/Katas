import { describe, expect, it } from 'vitest';
import { escapeMrkdwn, formatDigest, groupByAssignee, MAX_ISSUES_PER_ASSIGNEE, postDailyDigest } from './digest';
import type { ChatMessage, ChatNotifier, IssueSource, OpenIssue } from './ports';

const today = new Date('2026-11-24T07:00:00Z');

function issue(key: string, assignee: string | null, summary = `Summary of ${key}`): OpenIssue {
  return { key, summary, assignee, url: `https://example.atlassian.net/browse/${key}` };
}

describe('escapeMrkdwn', () => {
  it('replaces exactly the three control characters', () => {
    expect(escapeMrkdwn('Ping <!channel> & <@U0123> > "quotes" stay')).toBe(
      'Ping &lt;!channel&gt; &amp; &lt;@U0123&gt; &gt; "quotes" stay',
    );
  });
});

describe('groupByAssignee', () => {
  it('sorts assignees alphabetically and puts the unassigned issues last', () => {
    const groups = groupByAssignee([
      issue('A-1', 'Pau'),
      issue('A-2', null),
      issue('A-3', 'Laia'),
      issue('A-4', 'Pau'),
    ]);
    expect(groups.map((group) => [group.assignee, group.issues.map((i) => i.key)])).toEqual([
      ['Laia', ['A-3']],
      ['Pau', ['A-1', 'A-4']],
      [null, ['A-2']],
    ]);
  });
});

describe('formatDigest', () => {
  it('links each issue and escapes the text that comes from Jira', () => {
    const { text } = formatDigest([issue('PLAT-1', 'Ana <ops>', 'Fix <!channel> & co')], 'PLAT', today);
    expect(text).toBe(
      [
        '*Open issues in PLAT on 2026-11-24*: 1',
        '',
        '*Ana &lt;ops&gt;* (1)',
        '• <https://example.atlassian.net/browse/PLAT-1|PLAT-1> Fix &lt;!channel&gt; &amp; co',
      ].join('\n'),
    );
  });

  it(`shows at most ${MAX_ISSUES_PER_ASSIGNEE} issues per assignee and says how many more there are`, () => {
    const many = Array.from({ length: MAX_ISSUES_PER_ASSIGNEE + 2 }, (_, i) => issue(`PLAT-${i + 1}`, 'Marta'));
    const { text } = formatDigest(many, 'PLAT', today);
    expect(text).toContain('*Marta* (7)');
    expect(text).toContain('PLAT-5');
    expect(text).not.toContain('PLAT-6');
    expect(text).toMatch(/…and 2 more$/);
  });

  it('says so when nothing is open', () => {
    expect(formatDigest([], 'PLAT', today).text).toBe(
      '*Open issues in PLAT on 2026-11-24*: none. Nothing to review today.',
    );
  });
});

describe('postDailyDigest, with in-memory adapters instead of Jira and Slack', () => {
  it('posts the formatted digest and reports what it did', async () => {
    const issues = [issue('PLAT-1', 'Laia'), issue('PLAT-2', null), issue('PLAT-3', 'Pau')];
    const source: IssueSource = { listOpenIssues: async () => issues };
    const posted: ChatMessage[] = [];
    const chat: ChatNotifier = { post: async (message) => (posted.push(message), { messageId: 'm-1' }) };

    const result = await postDailyDigest({ source, chat, projectKey: 'PLAT', today });

    expect(posted).toEqual([formatDigest(issues, 'PLAT', today)]);
    expect(result).toEqual({ issueCount: 3, assigneeCount: 2, messageId: 'm-1' });
  });

  it('posts nothing when reading the issues fails', async () => {
    const source: IssueSource = { listOpenIssues: async () => Promise.reject(new Error('Jira is down')) };
    const posted: ChatMessage[] = [];
    const chat: ChatNotifier = { post: async (message) => (posted.push(message), { messageId: 'm-1' }) };
    await expect(postDailyDigest({ source, chat, projectKey: 'PLAT', today })).rejects.toThrow('Jira is down');
    expect(posted).toEqual([]);
  });
});
