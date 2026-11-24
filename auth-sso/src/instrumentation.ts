/** Runs once when the server starts, before it handles requests: a broken configuration stops it. */
export async function register() {
  // The dynamic import inside the check keeps Node-only code (`process.exit`) out of the Edge build.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { exitOnInvalidConfig } = await import('./exercises/oidc-nextjs/config');
    exitOnInvalidConfig();
  }
}
