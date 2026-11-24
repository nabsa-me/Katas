/**
 * Liveness endpoint for the Docker HEALTHCHECK and the Kubernetes probes. It only says the server
 * answers; it checks no dependency, so a database outage never makes the orchestrator restart it.
 * Route Handlers are not cached by default: each request runs this function.
 */
export function GET(): Response {
  return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
}
