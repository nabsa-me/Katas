import { LOCAL_SERVICES } from './local-services';

/**
 * Playwright global setup: the end-to-end tests log in against the mock provider, so they fail fast with the
 * command to run instead of timing out on a login page that never loads.
 */
export default async function requireMockOidc(): Promise<void> {
  const discovery = `${LOCAL_SERVICES.issuer}/.well-known/openid-configuration`;
  try {
    const response = await fetch(discovery, { signal: AbortSignal.timeout(3_000) });
    if (response.ok) return;
  } catch {
    // Not running or not reachable: reported below.
  }
  throw new Error(
    `The mock OIDC provider is not answering at ${discovery}. Start it first: docker compose up -d --wait`,
  );
}
