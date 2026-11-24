/**
 * Runs work after the HTTP response has been sent: the webhook handlers acknowledge at once and hand the slow part
 * here. In production this is a durable queue (SQS with a Lambda worker, for example), because in-memory work is
 * lost if the process stops; in-memory is enough to show the pattern and to test it.
 *
 * Errors go to `onError`: a background failure must be reported, and must never crash the process as an unhandled
 * rejection. `drain()` waits for everything started so far, for tests and for a graceful shutdown.
 */
export interface BackgroundTasks {
  run(task: () => Promise<void>): void;
  drain(): Promise<void>;
  readonly pending: number;
}

export function createBackgroundTasks(onError: (error: unknown) => void): BackgroundTasks {
  const running = new Set<Promise<void>>();
  return {
    run(task) {
      // `task` starts on the next microtask, never inside the caller's synchronous code.
      const promise: Promise<void> = Promise.resolve()
        .then(task)
        .catch(onError)
        .finally(() => running.delete(promise));
      running.add(promise);
    },
    async drain() {
      // Tasks may start other tasks, so keep waiting until nothing is left.
      while (running.size > 0) await Promise.all(running);
    },
    get pending() {
      return running.size;
    },
  };
}
