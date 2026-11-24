import { http, HttpResponse, type HttpHandler } from 'msw/http';
import data from '../data/jira-open-issues.json' with { type: 'json' };

/** An issue as the Jira search endpoint returns it, limited to the fields the katas request. */
export interface JiraIssueJson {
  id: string;
  key: string;
  fields: {
    summary: string;
    assignee: { displayName: string } | null;
    priority: { name: string } | null;
    status: { name: string };
  };
}

export interface FakeCredentials {
  jiraEmail: string;
  jiraApiToken: string;
  slackBotToken: string;
}

export const FAKE_JIRA_BASE_URL = 'https://example.atlassian.net';
export const SLACK_API_URL = 'https://slack.com/api';

/** Credentials the fakes accept by default. Deliberately not shaped like real tokens. */
export const FAKE_CREDENTIALS: FakeCredentials = {
  jiraEmail: 'digest-bot@example.com',
  jiraApiToken: 'fake-jira-api-token',
  slackBotToken: 'fake-slack-bot-token',
};

/** Twelve fictional open issues: three pages with the default page size. */
export const sampleIssues: readonly JiraIssueJson[] = data;

export interface FakeApiOptions {
  issues?: readonly JiraIssueJson[];
  /** Issues per page, whatever `maxResults` asks for, so a few issues already span several pages. */
  pageSize?: number;
  credentials?: FakeCredentials;
  /** HTTP statuses Jira answers with, in order, before it serves pages normally. A 429 carries `Retry-After`. */
  jiraFailures?: number[];
  /** Same for Slack. A number is an HTTP status; a string is an HTTP 200 with `ok: false` and that error code. */
  slackFailures?: Array<number | string>;
  retryAfterSeconds?: number;
}

export interface RecordedRequest {
  authorization: string | null;
  body: Record<string, unknown>;
}

export interface FakeApis {
  handlers: HttpHandler[];
  /** Every request that reached each fake, including the failed ones. */
  jiraRequests: RecordedRequest[];
  slackRequests: RecordedRequest[];
  /** Messages Slack accepted (`ok: true`). */
  slackPosts: Array<{ channel: string; text: string }>;
}

/**
 * msw handlers that stand in for Jira's issue search and Slack's `chat.postMessage`, with the behaviour that
 * matters in production: pagination with `nextPageToken`, credential checks, rate limits with `Retry-After`,
 * server errors and Slack's `ok: false` answers over HTTP 200.
 */
export function createFakeApis(options: FakeApiOptions = {}): FakeApis {
  const { issues = sampleIssues, pageSize = 5, credentials = FAKE_CREDENTIALS, retryAfterSeconds = 1 } = options;
  const jiraFailures = [...(options.jiraFailures ?? [])];
  const slackFailures = [...(options.slackFailures ?? [])];
  const fakes: FakeApis = { handlers: [], jiraRequests: [], slackRequests: [], slackPosts: [] };
  const jiraAuthorization = `Basic ${Buffer.from(`${credentials.jiraEmail}:${credentials.jiraApiToken}`).toString('base64')}`;

  const failure = (status: number, body: Record<string, unknown>) =>
    HttpResponse.json(body, {
      status,
      headers: status === 429 ? { 'Retry-After': String(retryAfterSeconds) } : {},
    });

  const searchJira = http.post(`${FAKE_JIRA_BASE_URL}/rest/api/3/search/jql`, async ({ request }) => {
    const body = await readJsonObject(request);
    const authorization = request.headers.get('authorization');
    fakes.jiraRequests.push({ authorization, body });
    if (authorization !== jiraAuthorization) {
      return failure(401, { errorMessages: ['Client must be authenticated to access this resource.'] });
    }
    const status = jiraFailures.shift();
    if (status !== undefined) return failure(status, { errorMessages: [`Simulated HTTP ${status}.`] });

    const offset = offsetFromToken(body.nextPageToken);
    if (offset === undefined) return failure(400, { errorMessages: ['The nextPageToken is not valid.'] });
    const next = offset + pageSize;
    const page = issues.slice(offset, next);
    return HttpResponse.json(
      next < issues.length
        ? { issues: page, nextPageToken: `page-${next}`, isLast: false }
        : { issues: page, isLast: true },
    );
  });

  const postMessage = http.post(`${SLACK_API_URL}/chat.postMessage`, async ({ request }) => {
    const body = await readJsonObject(request);
    const authorization = request.headers.get('authorization');
    fakes.slackRequests.push({ authorization, body });
    if (authorization !== `Bearer ${credentials.slackBotToken}`) {
      return HttpResponse.json({ ok: false, error: 'invalid_auth' });
    }
    const next = slackFailures.shift();
    if (typeof next === 'string') return HttpResponse.json({ ok: false, error: next });
    if (next !== undefined)
      return failure(next, { ok: false, error: next === 429 ? 'ratelimited' : 'service_unavailable' });

    const channel = String(body.channel);
    const text = String(body.text);
    fakes.slackPosts.push({ channel, text });
    const ts = `1764000000.${String(fakes.slackPosts.length).padStart(6, '0')}`;
    return HttpResponse.json({ ok: true, channel, ts, message: { type: 'message', text, ts } });
  });

  fakes.handlers.push(searchJira, postMessage);
  return fakes;
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => undefined);
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
}

/** The first page has no token; later pages carry the opaque `page-<offset>` token the previous page returned. */
function offsetFromToken(token: unknown): number | undefined {
  if (token === undefined || token === null) return 0;
  const match = typeof token === 'string' ? /^page-(\d+)$/.exec(token) : null;
  return match ? Number(match[1]) : undefined;
}
