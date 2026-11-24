import { z } from 'zod';
import { ConfigError } from './errors';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Config {
  jira: { baseUrl: string; email: string; apiToken: string; projectKey: string };
  slack: { botToken: string; channelId: string };
  requestTimeoutMs: number;
  logLevel: LogLevel;
}

/** Error message for a rule, or "is missing" when the variable is not set at all. */
const orMissing = (message: string) => (issue: { input?: unknown }) =>
  issue.input === undefined ? 'is missing' : message;

const required = () => z.string({ error: orMissing('must be a string') }).trim();

/** A secret: required, and never the placeholder copied from `.env.example`. */
const secret = () =>
  required().refine((value) => !value.startsWith('replace-with-'), 'still has the placeholder from .env.example');

const envSchema = z.object({
  JIRA_BASE_URL: z
    .url({
      protocol: /^https$/,
      hostname: z.regexes.domain,
      error: orMissing('must be an https URL such as https://your-site.atlassian.net'),
    })
    .transform((url) => url.replace(/\/+$/, '')),
  JIRA_EMAIL: z.email({ error: orMissing('must be the email of the account that owns the API token') }),
  JIRA_API_TOKEN: secret(),
  // Interpolated into JQL: the pattern is what keeps `PLAT OR project = HR` out of the query.
  JIRA_PROJECT_KEY: required().regex(/^[A-Z][A-Z0-9_]{1,9}$/, 'must be a Jira project key such as PLAT'),
  SLACK_BOT_TOKEN: secret(),
  SLACK_CHANNEL_ID: required().regex(/^[CG][A-Z0-9]{8,}$/, 'must be a channel id such as C0123456789, not a name'),
  REQUEST_TIMEOUT_MS: z.coerce
    .number({ error: 'must be a number of milliseconds' })
    .int()
    .min(1_000, 'must be at least 1000')
    .max(60_000, 'must be at most 60000')
    .default(10_000),
  LOG_LEVEL: z
    .enum(['debug', 'info', 'warn', 'error'], { error: 'must be debug, info, warn or error' })
    .default('info'),
});

/**
 * Reads and validates the configuration from environment variables, once, at startup. It fails fast with every
 * problem listed, so one run tells you everything to fix. Messages name the variable and the rule, never the
 * value: a misplaced secret must not end up in the logs through an error message.
 */
export function loadConfig(env: Record<string, string | undefined>): Config {
  // An empty variable (`JIRA_API_TOKEN=`) is a missing one, not an empty token.
  const present = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value.trim() !== ''),
  );
  const result = envSchema.safeParse(present);
  if (!result.success) {
    throw new ConfigError(result.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`));
  }
  const vars = result.data;
  return {
    jira: {
      baseUrl: vars.JIRA_BASE_URL,
      email: vars.JIRA_EMAIL,
      apiToken: vars.JIRA_API_TOKEN,
      projectKey: vars.JIRA_PROJECT_KEY,
    },
    slack: { botToken: vars.SLACK_BOT_TOKEN, channelId: vars.SLACK_CHANNEL_ID },
    requestTimeoutMs: vars.REQUEST_TIMEOUT_MS,
    logLevel: vars.LOG_LEVEL,
  };
}

/** What is safe to log about the configuration: everything except the secrets. */
export function describeConfig(config: Config) {
  return {
    jiraBaseUrl: config.jira.baseUrl,
    jiraProjectKey: config.jira.projectKey,
    slackChannelId: config.slack.channelId,
    requestTimeoutMs: config.requestTimeoutMs,
    logLevel: config.logLevel,
  };
}
