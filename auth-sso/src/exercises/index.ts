export interface Exercise {
  title: string;
  /** One sentence on what the exercise shows. */
  summary: string;
  /** The demo route in this app, or the command that runs the exercise when it lives outside Next.js. */
  demo: { href: string } | { command: string };
}

export const exercises: Exercise[] = [
  {
    title: 'OIDC in Next.js',
    summary:
      'Authorization Code + PKCE on the server, an httpOnly session cookie and roles checked on the server, instead of tokens in localStorage and a hidden button.',
    demo: { href: '/oidc-nextjs' },
  },
  {
    title: 'JWT validation in the API',
    summary:
      'Access tokens verified with jose (signature from the JWKS, allowed algorithms, iss, aud, exp) and a requireRole middleware, instead of decoding the token and trusting it.',
    demo: { command: 'npm run api' },
  },
];
