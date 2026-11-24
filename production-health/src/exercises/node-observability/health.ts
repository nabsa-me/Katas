/** Port: a cheap check that the database answers. `SELECT 1` through Postgres in the service, stubs in the tests. */
export interface DatabaseProbe {
  name: string;
  check(): Promise<void>;
}

export interface CheckResult {
  name: string;
  ok: boolean;
  durationMs: number;
  /** For the logs only: it can name hosts, users or internal addresses, so it never goes in the response. */
  error?: string;
}

export interface Readiness {
  status: 'ready' | 'not_ready' | 'draining';
  checks: CheckResult[];
}

export interface Health {
  /** `/healthz`: the process is alive and its event loop answers. No dependencies, on purpose. */
  liveness(): { status: 'ok' };
  /** `/readyz`: this instance can serve traffic now. */
  readiness(): Promise<Readiness>;
  /** From now on readiness fails, so the load balancer stops sending new requests before the process exits. */
  startDraining(): void;
}

/**
 * Liveness answers "restart me?" and readiness answers "send me traffic?". A dependency in liveness turns a
 * database outage into every instance restarting in a loop; readiness takes the instance out of rotation instead,
 * and puts it back when the check passes again.
 */
export function createHealth({ database, timeoutMs }: { database: DatabaseProbe; timeoutMs: number }): Health {
  let draining = false;
  return {
    liveness: () => ({ status: 'ok' }),
    async readiness() {
      if (draining) return { status: 'draining', checks: [] };
      const result = await runCheck(database, timeoutMs);
      return { status: result.ok ? 'ready' : 'not_ready', checks: [result] };
    },
    startDraining() {
      draining = true;
    },
  };
}

/** A probe that hangs is a failed probe: the orchestrator's own timeout must never be the first one to fire. */
async function runCheck(probe: DatabaseProbe, timeoutMs: number): Promise<CheckResult> {
  const started = performance.now();
  const durationMs = () => Math.round(performance.now() - started);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer after ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    await Promise.race([probe.check(), timeout]);
    return { name: probe.name, ok: true, durationMs: durationMs() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { name: probe.name, ok: false, durationMs: durationMs(), error: message };
  } finally {
    clearTimeout(timer);
  }
}
