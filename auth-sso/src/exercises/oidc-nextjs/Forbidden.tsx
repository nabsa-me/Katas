/** Shown with status 403 by the proxy, and by the admin page itself if the proxy ever misses a path. */
export function Forbidden() {
  return (
    <>
      <h1>403 · Forbidden</h1>
      <p>You are signed in, but your groups do not grant the admin role.</p>
      <p>
        <a href="/oidc-nextjs">Back to the exercise</a>
      </p>
    </>
  );
}
