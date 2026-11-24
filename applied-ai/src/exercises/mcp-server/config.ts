import { z } from 'zod';

const envSchema = z.object({
  JIRA_BASE_URL: z.url({ protocol: /^https$/, error: 'expected the https URL of the Jira site' }),
  JIRA_EMAIL: z.email('expected the email of the Jira account that owns the API token'),
  JIRA_API_TOKEN: z.string().min(1, 'expected a Jira API token'),
  JIRA_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

export interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  /** How long one Jira request may take before the tool answers with an error. */
  timeoutMs: number;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/**
 * Reads the Jira connection from the environment once, at startup, and fails listing every problem. The token is
 * never part of the message: zod reports which variable is wrong, not its value.
 */
export function loadJiraConfig(env: Record<string, string | undefined> = process.env): JiraConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) throw new ConfigError(`Invalid Jira configuration:\n${z.prettifyError(parsed.error)}`);
  const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_TIMEOUT_MS } = parsed.data;
  return {
    baseUrl: JIRA_BASE_URL.replace(/\/+$/, ''),
    email: JIRA_EMAIL,
    apiToken: JIRA_API_TOKEN,
    timeoutMs: JIRA_TIMEOUT_MS,
  };
}
