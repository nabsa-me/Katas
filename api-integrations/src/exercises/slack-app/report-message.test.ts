import { describe, expect, it } from 'vitest';
import { escapeMrkdwn, MAX_LISTED_ISSUES, reportMessage } from './report-message';

describe('escapeMrkdwn', () => {
  it('escapes &, < and > so user text cannot become mentions or links', () => {
    expect(escapeMrkdwn('Fix <!channel> & <https://example.com|this>')).toBe(
      'Fix &lt;!channel&gt; &amp; &lt;https://example.com|this&gt;',
    );
  });
});

describe('reportMessage', () => {
  const issues = [
    { key: 'PLAT-101', summary: 'Rotate the database credentials', status: 'To Do' },
    { key: 'PLAT-102', summary: 'Compare a < b in the <b>report</b>', status: 'In Progress' },
  ];

  it('builds an ephemeral Block Kit message with a fallback text', () => {
    const message = reportMessage({ projectKey: 'PLAT', issues }, 'U2CERLKJA');
    expect(message.response_type).toBe('ephemeral');
    expect(message.text).toBe('Open issues in PLAT: 2');
    expect(message.blocks).toEqual([
      { type: 'header', text: { type: 'plain_text', text: 'Open issues in PLAT: 2' } },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text:
            '• *PLAT-101* Rotate the database credentials · _To Do_\n' +
            '• *PLAT-102* Compare a &lt; b in the &lt;b&gt;report&lt;/b&gt; · _In Progress_',
        },
      },
      { type: 'context', elements: [{ type: 'mrkdwn', text: 'Requested by <@U2CERLKJA>' }] },
    ]);
  });

  it('lists at most ten issues and summarizes the rest', () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ key: `PLAT-${i}`, summary: 'Task', status: 'To Do' }));
    const section = reportMessage({ projectKey: 'PLAT', issues: many }, 'U1').blocks?.[1] as { text: { text: string } };
    const lines = section.text.text.split('\n');
    expect(lines).toHaveLength(MAX_LISTED_ISSUES + 1);
    expect(lines.at(-1)).toBe('…and 3 more');
  });

  it('says so when nothing is open', () => {
    const section = reportMessage({ projectKey: 'PLAT', issues: [] }, 'U1').blocks?.[1] as { text: { text: string } };
    expect(section.text.text).toBe('Nothing open. 🎉');
  });
});
