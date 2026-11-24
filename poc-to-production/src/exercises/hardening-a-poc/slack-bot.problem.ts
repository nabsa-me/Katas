// Daily digest bot: posts the open Jira issues of a project to a Slack channel, grouped by assignee.
// The proof of concept as it was handed over. It works on a good day, on the developer's machine.
// Everything happens at import time, so the tests import it to run it.

const JIRA_URL = 'https://example.atlassian.net';
const JIRA_EMAIL = 'digest-bot@example.com';
const JIRA_TOKEN = 'replace-with-a-jira-api-token'; // BUG: a secret in the source code, and so in git history
const SLACK_TOKEN = 'replace-with-a-slack-bot-token';
const CHANNEL = 'C0123456789';

const headers = {
  Authorization: 'Basic ' + Buffer.from(JIRA_EMAIL + ':' + JIRA_TOKEN).toString('base64'),
  'Content-Type': 'application/json',
};
// BUG: the Authorization header is base64, not encryption: this line prints the credentials to the logs.
console.log('Calling Jira with', headers);

// BUG: one request and no pagination. Jira returns a page of issues and a nextPageToken that nobody reads.
// No timeout, no status check, no retry: a 429 or a 503 ends in a TypeError a few lines below.
const res = await fetch(JIRA_URL + '/rest/api/3/search/jql', {
  method: 'POST',
  headers,
  body: JSON.stringify({ jql: 'project = PLAT AND statusCategory != Done', fields: ['summary', 'assignee'] }),
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the PoC trusts whatever comes back
const data: any = await res.json();

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped grouping, as in the PoC
const byAssignee: any = {};
for (const issue of data.issues) {
  const name = issue.fields.assignee.displayName; // BUG: an unassigned issue has `assignee: null`
  byAssignee[name] = byAssignee[name] || [];
  byAssignee[name].push(issue);
}

let text = 'Open issues\n';
for (const name in byAssignee) {
  text += '*' + name + '*\n';
  for (const issue of byAssignee[name]) {
    // BUG: no escaping. A summary with `<!channel>` notifies the whole channel; `<` and `&` break the markup.
    text += '• ' + issue.key + ' ' + issue.fields.summary + '\n';
  }
}

const slack = await fetch('https://slack.com/api/chat.postMessage', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + SLACK_TOKEN, 'Content-Type': 'application/json' },
  body: JSON.stringify({ channel: CHANNEL, text }),
});
// BUG: Slack answers errors with HTTP 200 and `ok: false`. This prints "Posted!" for those too,
// and the process exits with 0, so a scheduler never finds out.
console.log('Posted!', await slack.json());
