import { exercises } from '../../lib/exercises';

export default function HomePage() {
  return (
    <main className="page">
      <h1>Next.js SSR and hydration katas</h1>
      <p className="muted">
        Each exercise has routes for the flawed version and for the solution. Open the browser console to see what React
        reports during hydration. The statement and the explained solution are in the README of each exercise folder.
      </p>
      {exercises.map((exercise) => (
        <section key={exercise.folder}>
          <h2>{exercise.title}</h2>
          <ul>
            {exercise.routes.map((route) => (
              <li key={route.href}>
                <span className={`tag ${route.kind}`}>{route.kind}</span>{' '}
                {/* A plain link: every exercise has its own root layout, so it is a full page load anyway. */}
                <a href={route.href}>{route.label}</a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
