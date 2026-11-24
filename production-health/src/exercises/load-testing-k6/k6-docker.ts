/** Pinned: a load test is only comparable with another run of the same tool version. */
export const K6_IMAGE = 'grafana/k6:2.4.0';

export interface K6DockerOptions {
  /** The service as seen from inside the container. */
  baseUrl: string;
  /** Extra arguments for `k6 run`, such as `--summary-mode=full`. */
  k6Args?: readonly string[];
  image?: string;
}

/**
 * Arguments for `docker run` that execute a k6 script read from stdin (`k6 run -`), so nothing is mounted and the
 * same command works from Windows, macOS and Linux. `host.docker.internal` is the host machine: Docker Desktop
 * defines it, and `--add-host=…:host-gateway` defines it on Linux too.
 */
export function k6DockerArgs({ baseUrl, k6Args = [], image = K6_IMAGE }: K6DockerOptions): string[] {
  return [
    'run',
    '--rm',
    '-i',
    '--add-host=host.docker.internal:host-gateway',
    '-e',
    `BASE_URL=${baseUrl}`,
    image,
    'run',
    ...k6Args,
    '-',
  ];
}

export type ServiceCheck = { ok: true } | { ok: false; reason: string };

/** Asks the service's readiness endpoint before spending minutes on a load test against nothing. */
export async function checkServiceReady(serviceUrl: string, timeoutMs = 2_000): Promise<ServiceCheck> {
  try {
    const response = await fetch(`${serviceUrl}/readyz`, { signal: AbortSignal.timeout(timeoutMs) });
    await response.body?.cancel();
    return response.ok ? { ok: true } : { ok: false, reason: `/readyz answered ${response.status}` };
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    return { ok: false, reason: cause instanceof Error ? cause.message : String(cause) };
  }
}
