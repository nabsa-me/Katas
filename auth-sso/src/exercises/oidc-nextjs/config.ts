export interface OidcAppConfig {
  issuer: URL;
  clientId: string;
  /** Public URL of the app: the redirect and post-logout URIs are built from it, never from request headers. */
  appUrl: URL;
  /** Key for the HS256 signature of the session and login-transaction cookies. */
  sessionSecret: Uint8Array;
}

/** Every configuration problem at once, so a broken deployment is fixed in one go. */
export class ConfigError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Invalid auth configuration:\n${problems.map((problem) => `- ${problem}`).join('\n')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

const MIN_SECRET_LENGTH = 32;

/** Validates the environment. Environment variables are external input: nothing is used before this passes. */
export function parseConfig(env: Record<string, string | undefined>): OidcAppConfig {
  const problems: string[] = [];
  const issuer = parseUrl('OIDC_ISSUER', env.OIDC_ISSUER, problems);
  const appUrl = parseUrl('APP_URL', env.APP_URL, problems);
  // Tokens travel to and from the issuer: plain http is acceptable only for a provider on this machine.
  if (issuer && issuer.protocol !== 'https:' && issuer.hostname !== 'localhost') {
    problems.push('OIDC_ISSUER must use https (http is only accepted for localhost)');
  }
  const clientId = env.OIDC_CLIENT_ID?.trim() ?? '';
  if (!clientId) problems.push('OIDC_CLIENT_ID is missing');
  const secret = env.SESSION_SECRET ?? '';
  if (!secret) problems.push('SESSION_SECRET is missing');
  else if (secret.length < MIN_SECRET_LENGTH) {
    problems.push(`SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  } else if (secret.startsWith('replace-with-')) {
    problems.push('SESSION_SECRET still has the placeholder from .env.example');
  }

  if (problems.length > 0 || !issuer || !appUrl) throw new ConfigError(problems);
  return { issuer, clientId, appUrl, sessionSecret: new TextEncoder().encode(secret) };
}

function parseUrl(name: string, value: string | undefined, problems: string[]): URL | undefined {
  if (!value) {
    problems.push(`${name} is missing`);
    return undefined;
  }
  const url = URL.parse(value);
  if (url?.protocol === 'http:' || url?.protocol === 'https:') return url;
  // `URL.parse('localhost:5804')` succeeds with the scheme `localhost:`, hence the protocol check.
  problems.push(`${name} must be an http or https URL`);
  return undefined;
}

let cached: OidcAppConfig | undefined;

/** The validated configuration of the running server, read once from `process.env`. */
export function getConfig(): OidcAppConfig {
  cached ??= parseConfig(process.env);
  return cached;
}

/**
 * Called when the server starts (`src/instrumentation.ts`). Without it, Next.js would log the error, keep
 * serving and answer 500 on every request that needs the configuration.
 */
export function exitOnInvalidConfig(): void {
  try {
    getConfig();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
