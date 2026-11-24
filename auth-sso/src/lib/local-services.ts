/** Local addresses of the kata's services. Ports are fixed and unique across the katas. */
export const LOCAL_SERVICES = {
  /** The Next.js app (`npm run dev` / `npm run start`). */
  appUrl: 'http://localhost:5804',
  /** The demo API that validates access tokens (`npm run api`). */
  apiUrl: 'http://localhost:5805',
  /** Issuer of the mock OpenID Connect provider (`docker compose up -d --wait`). */
  issuer: 'http://localhost:5806/katas',
} as const;
