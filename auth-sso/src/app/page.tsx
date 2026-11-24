import { exercises } from '../exercises';

export default function Home() {
  return (
    <>
      <h1>Auth and SSO katas</h1>
      <p>
        Each exercise shows the flawed version next to the fixed one. The identity provider is a local mock started with{' '}
        <code>docker compose up -d --wait</code>: any username signs in, <code>ada</code> belongs to the admins group
        and <code>grace</code> only to the readers group.
      </p>
      <ul className="plain">
        {exercises.map((exercise) => (
          <li key={exercise.title} className="card">
            <h2>{'href' in exercise.demo ? <a href={exercise.demo.href}>{exercise.title}</a> : exercise.title}</h2>
            <p>{exercise.summary}</p>
            {'command' in exercise.demo && (
              <p className="muted">
                Runs outside this app: <code>{exercise.demo.command}</code>
              </p>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
