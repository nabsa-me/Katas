import { setupServer } from 'msw/node';
import { createFakeApis, FAKE_CREDENTIALS, FAKE_JIRA_BASE_URL } from '../../lib/fake-apis';
import { main } from './main';

/**
 * Runs the bot against the fake Jira and Slack (msw intercepts `fetch` in this process), so it can be compared
 * without credentials: `npm run demo` for the hardened bot, `npm run demo:problem` for the PoC.
 * Same twelve issues in both runs, three pages of five.
 */
const runProblem = process.argv[2] === 'problem';

// The placeholders hardcoded in `slack-bot.problem.ts`: the fakes only answer requests that carry them.
const pocCredentials = {
  jiraEmail: 'digest-bot@example.com',
  jiraApiToken: 'replace-with-a-jira-api-token',
  slackBotToken: 'replace-with-a-slack-bot-token',
};

const fakes = createFakeApis({ credentials: runProblem ? pocCredentials : FAKE_CREDENTIALS });
const server = setupServer(...fakes.handlers);
server.listen({ onUnhandledFrame: 'error' });

try {
  if (runProblem) {
    await import('./slack-bot.problem');
  } else {
    process.exitCode = await main({
      env: {
        JIRA_BASE_URL: FAKE_JIRA_BASE_URL,
        JIRA_EMAIL: FAKE_CREDENTIALS.jiraEmail,
        JIRA_API_TOKEN: FAKE_CREDENTIALS.jiraApiToken,
        JIRA_PROJECT_KEY: 'PLAT',
        SLACK_BOT_TOKEN: FAKE_CREDENTIALS.slackBotToken,
        SLACK_CHANNEL_ID: 'C0123456789',
      },
    });
  }
} finally {
  server.close();
}

console.log(`\nJira search requests: ${fakes.jiraRequests.length}`);
console.log(`Messages accepted by Slack: ${fakes.slackPosts.length}`);
for (const post of fakes.slackPosts) console.log(`\n${post.text}`);
