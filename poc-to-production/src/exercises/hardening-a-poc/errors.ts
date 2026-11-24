/** The configuration is incomplete or invalid. Lists every problem at once and never includes the values. */
export class ConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid configuration:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

export type UpstreamService = 'jira' | 'slack';

export interface UpstreamErrorDetails {
  service: UpstreamService;
  /** What the bot was doing, such as `search issues` or `chat.postMessage`. */
  operation: string;
  /** HTTP status, when there was a response. */
  status?: number;
  /** Machine-readable reason: `timeout`, `network`, `http_503`, or Slack's `error` field (`channel_not_found`). */
  code: string;
  /** Whether trying the same request again can succeed without side effects. */
  retryable: boolean;
  /** Minimum wait the service asked for with `Retry-After`. */
  retryAfterMs?: number;
  cause?: unknown;
}

/**
 * A call to Jira or Slack failed. It carries everything the retry policy and the logs need, so neither has to
 * parse messages. The original error travels in `cause` (pino prints its message and stack too).
 */
export class UpstreamError extends Error {
  readonly service: UpstreamService;
  readonly operation: string;
  readonly status: number | undefined;
  readonly code: string;
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;

  constructor(details: UpstreamErrorDetails, message = describe(details)) {
    super(message, { cause: details.cause });
    this.name = 'UpstreamError';
    this.service = details.service;
    this.operation = details.operation;
    this.status = details.status;
    this.code = details.code;
    this.retryable = details.retryable;
    this.retryAfterMs = details.retryAfterMs;
  }
}

/**
 * The service answered, but not with the shape the bot relies on (an API change, a proxy's HTML error page).
 * Retrying does not help: someone has to look at it.
 */
export class InvalidResponseError extends UpstreamError {
  readonly issues: readonly string[];

  constructor(service: UpstreamService, operation: string, issues: readonly string[], cause?: unknown) {
    super(
      { service, operation, code: 'invalid_response', retryable: false, cause },
      `${service} ${operation}: unexpected response (${issues.join('; ')})`,
    );
    this.name = 'InvalidResponseError';
    this.issues = issues;
  }
}

function describe({ service, operation, status, code }: UpstreamErrorDetails): string {
  return `${service} ${operation} failed: ${code}${status === undefined ? '' : ` (HTTP ${status})`}`;
}
