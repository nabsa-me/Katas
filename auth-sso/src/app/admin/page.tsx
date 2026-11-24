import { redirect } from 'next/navigation';
import { ACCESS_REVIEW } from '../../exercises/oidc-nextjs/admin-report';
import { currentUser } from '../../exercises/oidc-nextjs/current-user';
import { Forbidden } from '../../exercises/oidc-nextjs/Forbidden';
import { hasRole } from '../../exercises/oidc-nextjs/guard';

export default async function AdminPage() {
  // Defense in depth: the proxy already decided, but the data is rendered only after checking here too.
  const user = await currentUser();
  if (!user) redirect('/api/auth/login?returnTo=%2Fadmin');
  if (!hasRole(user, 'admin')) return <Forbidden />;

  return (
    <>
      <h1>Admin · access review</h1>
      <p>Signed in as {user.name}. Only the admin role reaches this page.</p>
      <ul className="plain">
        {ACCESS_REVIEW.map((entry) => (
          <li key={entry.user} className="card">
            <strong>{entry.user}</strong>
            <span className="muted">
              {entry.groups.join(', ')} · last sign-in {entry.lastSignIn}
            </span>
          </li>
        ))}
      </ul>
      <p>
        <a href="/oidc-nextjs">Back to the exercise</a>
      </p>
    </>
  );
}
