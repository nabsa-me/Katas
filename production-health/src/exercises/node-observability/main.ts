import { createServer } from 'node:http';
import * as Sentry from '@sentry/node';
import { createPool } from '../../lib/postgres';
import { createApp } from './app';
import { loadConfig, SERVICE_NAME } from './config';
import { createEmfWriter } from './emf';
import { createHealth } from './health';
import { createLogger, logIdleConnectionError } from './logger';
import { createPostgresIssueRepository, createPostgresProbe } from './postgres-issues';
import { reportToSentry } from './sentry';

// Composition root: the only file that reads the environment, opens connections and listens on a port.
// Run it with `npm start` (which loads instrument.ts first).

const config = loadConfig(process.env);
const logger = createLogger(config.logLevel);

const onPoolError = logIdleConnectionError(logger);
const pool = createPool({ connectionString: config.databaseUrl, applicationName: SERVICE_NAME, onError: onPoolError });
// The readiness probe gets its own single connection: at peak load the app pool is busy by design, and a probe
// queueing behind it would fail, take the instance out of rotation and push its traffic onto the others.
const probePool = createPool({
  connectionString: config.databaseUrl,
  applicationName: `${SERVICE_NAME}-readiness`,
  max: 1,
  connectionTimeoutMillis: config.readinessTimeoutMs,
  onError: onPoolError,
});

const health = createHealth({ database: createPostgresProbe(probePool), timeoutMs: config.readinessTimeoutMs });
const server = createServer(
  createApp({
    issues: createPostgresIssueRepository(pool, logger),
    health,
    logger,
    emitMetrics: createEmfWriter(),
    reportError: reportToSentry,
  }),
);

// Without this listener a port already in use is an uncaught exception with a stack trace; with it, one clear line.
server.on('error', (error: NodeJS.ErrnoException) => {
  const message = error.code === 'EADDRINUSE' ? `port ${config.port} is already in use` : 'server error';
  logger.fatal({ err: error }, message);
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  logger.info({ url: `http://${config.host}:${config.port}`, sentry: Boolean(config.sentry) }, 'listening');
});

// Crashes still crash (the process state is unknown after one), but never without a log line saying why.
process.on('uncaughtExceptionMonitor', (error, origin) => logger.fatal({ err: error, origin }, 'crashing'));

let stopping = false;

/**
 * Graceful shutdown on SIGTERM (what ECS and Kubernetes send) or Ctrl+C: fail readiness and keep serving for
 * DRAIN_DELAY_MS so the load balancer stops routing here, then stop accepting connections, finish the requests in
 * flight, close the pools, flush Sentry, and let the process exit on its own.
 */
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ signal, drainDelayMs: config.drainDelayMs }, 'shutting down');
  health.startDraining();
  await new Promise((resolve) => setTimeout(resolve, config.drainDelayMs));
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeIdleConnections();
  });
  await Promise.all([pool.end(), probePool.end(), Sentry.close(2_000)]);
  logger.info('stopped');
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    shutdown(signal).catch((error: unknown) => {
      logger.fatal({ err: error }, 'shutdown failed');
      process.exitCode = 1;
    });
  });
}
