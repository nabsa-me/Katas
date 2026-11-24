import { z } from 'zod';
import { LOCAL_DATABASE_URL } from '../../lib/postgres';

/** The service's name in logs, metrics and alarms. One constant, so the three always agree. */
export const SERVICE_NAME = 'issues-service';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  logLevel: LogLevel;
  readinessTimeoutMs: number;
  drainDelayMs: number;
  sentry: { dsn: string; environment: string } | undefined;
}

const envSchema = z.object({
  PORT: z.coerce.number({ error: 'must be a port number' }).int().min(1).max(65_535).default(5808),
  // Loopback by default: nothing outside this machine reaches the service unless HOST says so (0.0.0.0).
  HOST: z.string().min(1).default('127.0.0.1'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'must be a postgres:// URL' }).default(LOCAL_DATABASE_URL),
  LOG_LEVEL: z
    .enum(['debug', 'info', 'warn', 'error'], { error: 'must be debug, info, warn or error' })
    .default('info'),
  READINESS_TIMEOUT_MS: z.coerce
    .number({ error: 'must be a number of milliseconds' })
    .int()
    .min(100)
    .max(10_000)
    .default(1_000),
  // After SIGTERM, how long /readyz fails while requests are still served, so the load balancer notices first.
  DRAIN_DELAY_MS: z.coerce.number({ error: 'must be a number of milliseconds' }).int().min(0).max(60_000).default(0),
  SENTRY_DSN: z.url({ protocol: /^https?$/, error: 'must be the DSN URL from the Sentry project settings' }).optional(),
  SENTRY_ENVIRONMENT: z.string().min(1).default('local'),
});

/**
 * Validates the environment once, at startup, and fails listing every problem. Messages name the variable, never
 * its value: `DATABASE_URL` carries a password, and an error message is a log line like any other.
 */
export function loadConfig(env: Record<string, string | undefined>): Config {
  // An empty variable (`SENTRY_DSN=`) counts as unset, which is how .env files usually switch things off.
  const present = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined && value !== ''));
  const result = envSchema.safeParse(present);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`);
    throw new Error(`Invalid configuration: ${problems.join('; ')}`);
  }
  const vars = result.data;
  return {
    port: vars.PORT,
    host: vars.HOST,
    databaseUrl: vars.DATABASE_URL,
    logLevel: vars.LOG_LEVEL,
    readinessTimeoutMs: vars.READINESS_TIMEOUT_MS,
    drainDelayMs: vars.DRAIN_DELAY_MS,
    sentry: vars.SENTRY_DSN ? { dsn: vars.SENTRY_DSN, environment: vars.SENTRY_ENVIRONMENT } : undefined,
  };
}
