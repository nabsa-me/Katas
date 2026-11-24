import { BedrockRuntimeClient, type BedrockRuntimeClientConfig } from '@aws-sdk/client-bedrock-runtime';
import { NodeHttp2Handler } from '@smithy/node-http-handler';
import { z } from 'zod';

/** Global cross-Region inference profile for Claude Opus 5.5; the in-Region model id is `anthropic.claude-opus-5-5`. */
export const DEFAULT_MODEL_ID = 'global.anthropic.claude-opus-5-5';

const envSchema = z.object({
  AWS_REGION: z.string().regex(/^[a-z]{2}(-[a-z]+)+-\d+$/, 'expected an AWS Region such as us-east-1'),
  BEDROCK_MODEL_ID: z.string().min(1).default(DEFAULT_MODEL_ID),
  BEDROCK_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  BEDROCK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  BEDROCK_MAX_TOKENS: z.coerce.number().int().positive().default(16_000),
});

export interface BedrockConfig {
  region: string;
  /** A model id or an inference profile id. Configuration, not code: it changes per Region and per release. */
  modelId: string;
  /** Longest silence allowed on one HTTP/2 stream before the attempt fails with `TimeoutError` (and is retried). */
  timeoutMs: number;
  /** Total attempts per call, the first one included. */
  maxAttempts: number;
  maxTokens: number;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/** Reads the configuration from the environment and fails fast, listing every problem at once. */
export function loadBedrockConfig(env: Record<string, string | undefined> = process.env): BedrockConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) throw new ConfigError(`Invalid Bedrock configuration:\n${z.prettifyError(parsed.error)}`);
  const { AWS_REGION, BEDROCK_MODEL_ID, BEDROCK_TIMEOUT_MS, BEDROCK_MAX_ATTEMPTS, BEDROCK_MAX_TOKENS } = parsed.data;
  return {
    region: AWS_REGION,
    modelId: BEDROCK_MODEL_ID,
    timeoutMs: BEDROCK_TIMEOUT_MS,
    maxAttempts: BEDROCK_MAX_ATTEMPTS,
    maxTokens: BEDROCK_MAX_TOKENS,
  };
}

/** Where to send requests and which credentials to sign them with. Tests point it at a local fake server. */
export type ConnectionOverrides = Pick<BedrockRuntimeClientConfig, 'endpoint' | 'credentials'>;

/**
 * A Bedrock Runtime client with an explicit timeout and retry budget. The SDK's default handler for this client is
 * `NodeHttp2Handler` with `disableConcurrentStreams: true` and no request timeout, so the same handler is kept
 * (passing `NodeHttpHandler` would silently downgrade to HTTP/1.1) and only `requestTimeout` is added. A timed-out
 * attempt throws `TimeoutError`, which the standard retry strategy treats as transient and retries with backoff,
 * like throttling (`ThrottlingException`) and 5xx errors; a 4xx such as `ValidationException` fails at once.
 * Credentials come from the default provider chain (environment, SSO profile, container or instance role).
 */
export function createBedrockClient(config: BedrockConfig, overrides: ConnectionOverrides = {}): BedrockRuntimeClient {
  return new BedrockRuntimeClient({
    region: config.region,
    maxAttempts: config.maxAttempts,
    requestHandler: new NodeHttp2Handler({ requestTimeout: config.timeoutMs, disableConcurrentStreams: true }),
    ...overrides,
  });
}
