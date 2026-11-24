import { z } from 'zod';
import { sleep as realSleep, type Clock, type Sleep } from '../../lib/time';

/** One entry of the `errors` array. `path` points at the field that failed, such as `['goals_search', 'edges', 1]`. */
export const graphqlErrorSchema = z.object({
  message: z.string(),
  path: z.array(z.union([z.string(), z.number()])).optional(),
  locations: z.array(z.object({ line: z.number(), column: z.number() })).optional(),
  extensions: z.record(z.string(), z.unknown()).optional(),
});

export type GraphqlError = z.infer<typeof graphqlErrorSchema>;

const envelopeSchema = z.object({
  data: z.unknown().optional(),
  errors: z.array(graphqlErrorSchema).optional(),
});

/** Both halves of a GraphQL response: `data` may be partial and `errors` may be non-empty at the same time. */
export interface GraphqlResult {
  data: unknown;
  errors: GraphqlError[];
}

/** The response was not a GraphQL response at all (an auth failure, a gateway error page, a 5xx…). */
export class GraphqlHttpError extends Error {
  readonly status: number;

  constructor(status: number, detail: string) {
    super(`GraphQL endpoint answered ${status}${detail ? `: ${detail}` : ''}`);
    this.name = 'GraphqlHttpError';
    this.status = status;
  }
}

export interface GraphqlClientOptions {
  /** `https://your-site.atlassian.net/gateway/api/graphql` (API token) or `https://api.atlassian.com/graphql` (OAuth). */
  endpoint: string;
  /** `basicAuth(email, apiToken)`, or `Bearer <access token>` with OAuth. */
  authorization: string;
  now?: Clock;
  sleep?: Sleep;
  /** Attempts for a rate-limited (429) request, the first one included. */
  maxAttempts?: number;
  /** Longest wait worth doing before a retry; beyond it the client fails and the caller reschedules. */
  maxWaitMs?: number;
}

export type GraphqlClient = ReturnType<typeof createGraphqlClient>;

export function createGraphqlClient({
  endpoint,
  authorization,
  now = Date.now,
  sleep = realSleep,
  maxAttempts = 3,
  maxWaitMs = 60_000,
}: GraphqlClientOptions) {
  /**
   * Runs one operation and returns `data` and `errors` as they came. It does not decide whether a response with
   * errors is a failure: only the caller knows whether the valid part is useful.
   */
  async function execute(query: string, variables: Record<string, unknown> = {}): Promise<GraphqlResult> {
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ query, variables }),
      });

      // Rate limiting applies to the whole request, so it comes as HTTP 429 and never inside `errors`.
      if (response.status === 429) {
        const waitMs = retryAfterDelayMs(response.headers.get('retry-after'), now());
        if (attempt >= maxAttempts || waitMs === null || waitMs > maxWaitMs) {
          throw new GraphqlHttpError(429, 'rate limited');
        }
        await response.body?.cancel();
        await sleep(waitMs);
        continue;
      }

      // Decide by the body, not by the status: a GraphQL envelope is returned whatever the status says.
      const text = await response.text();
      const envelope = envelopeSchema.safeParse(parseJson(text));
      if (envelope.success && (envelope.data.data !== undefined || envelope.data.errors !== undefined)) {
        return { data: envelope.data.data ?? null, errors: envelope.data.errors ?? [] };
      }
      // Anything else is a transport failure. 5xx are not retried: Atlassian asks clients not to add load then.
      throw new GraphqlHttpError(response.status, text.slice(0, 200));
    }
  }

  return { execute };
}

/**
 * Milliseconds to wait from a `Retry-After` header. Atlassian's GraphQL gateway sends a timestamp
 * (`2026-05-10T11:00Z`), which is neither of HTTP's standard forms; whole seconds and HTTP dates are accepted too,
 * so the function is right whatever the server sends. `null` when the header is missing or unreadable.
 */
export function retryAfterDelayMs(header: string | null, nowMs: number): number | null {
  const value = header?.trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - nowMs);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
