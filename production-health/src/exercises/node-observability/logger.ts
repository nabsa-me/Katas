import { pino, stdTimeFunctions, type DestinationStream, type Logger } from 'pino';
import { SERVICE_NAME, type LogLevel } from './config';
import { currentContext, runOutsideContext } from './context';

export type { Logger };

/**
 * JSON lines on stdout, one object per event. `mixin()` runs for every line and adds the correlation id of the
 * request being handled, read from `AsyncLocalStorage`: no child logger to pass around, and code that knows
 * nothing about requests (the repository) still writes lines that can be joined to one. `destination` is for tests.
 */
export function createLogger(level: LogLevel, destination?: DestinationStream): Logger {
  return pino(
    {
      level,
      base: { service: SERVICE_NAME },
      timestamp: stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      mixin: () => {
        const context = currentContext();
        return context ? { correlationId: context.correlationId } : {};
      },
    },
    destination,
  );
}

/** The pool's `error` listener: an idle connection failing belongs to no request, whatever its async origin. */
export function logIdleConnectionError(logger: Logger): (error: Error) => void {
  return (error) => runOutsideContext(() => logger.error({ err: error }, 'idle database connection failed'));
}
