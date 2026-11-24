import { connection } from 'next/server';
import { getConfig } from '../../../exercises/oidc-nextjs/config';
import { LocalStorageLogin } from '../../../exercises/oidc-nextjs/LocalStorageLogin.problem';

export default async function OidcNextjsProblemPage() {
  // Read the configuration per request, not once at build time.
  await connection();
  const { issuer, clientId, appUrl } = getConfig();

  return (
    <>
      <h1>OIDC in Next.js · problem</h1>
      <p>
        Sign in as <code>grace</code>: there is no admin button, yet <code>/api/problem/admin-report</code> returns the
        data to anyone. Then run <code>localStorage.getItem(&apos;access_token&apos;)</code> in the console: any script
        on the page can do the same.
      </p>
      <section className="card" aria-label="Problem">
        <h2 className="tag problem">Problem</h2>
        <LocalStorageLogin
          issuer={issuer.href.replace(/\/$/, '')}
          clientId={clientId}
          redirectUri={new URL('/oidc-nextjs/problem', appUrl).href}
        />
      </section>
      <p>
        <a href="/oidc-nextjs">Back to the solution</a>
      </p>
    </>
  );
}
