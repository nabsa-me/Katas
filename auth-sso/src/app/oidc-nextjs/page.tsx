import { currentUser } from '../../exercises/oidc-nextjs/current-user';

export default async function OidcNextjsPage() {
  const user = await currentUser();

  return (
    <>
      <h1>OIDC in Next.js</h1>
      <p>
        Sign in as <code>ada</code> (admins group) or <code>grace</code> (readers group), then open the admin page or
        call the admin API. Typing <code>/admin</code> as <code>grace</code> answers 403: the role is checked on the
        server, not by hiding links.
      </p>

      <section className="card" aria-label="Solution">
        <h2 className="tag solution">Solution</h2>
        <p className="muted">
          Authorization Code + PKCE run on the server. The browser only holds an httpOnly session cookie.
        </p>
        {user ? (
          <p>
            Signed in as <strong>{user.name}</strong> · roles: {user.roles.join(', ') || 'none'}
          </p>
        ) : (
          <p>Not signed in.</p>
        )}
        <div className="actions">
          {user ? (
            <form method="post" action="/api/auth/logout">
              <button type="submit">Log out</button>
            </form>
          ) : (
            <a className="button" href="/api/auth/login?returnTo=%2Foidc-nextjs">
              Log in
            </a>
          )}
          <a className="button" href="/admin">
            Admin page
          </a>
          <a className="button" href="/api/admin/report">
            Admin API
          </a>
        </div>
      </section>

      <section className="card" aria-label="Problem">
        <h2 className="tag problem">Problem</h2>
        <p>
          The same login done in the browser: tokens in <code>localStorage</code> and the admin button hidden by a role
          check in the UI, while the API behind it checks nothing.
        </p>
        <div className="actions">
          <a className="button" href="/oidc-nextjs/problem">
            Open the problem version
          </a>
        </div>
      </section>
    </>
  );
}
