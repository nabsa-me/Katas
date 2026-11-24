import { useSyncExternalStore } from 'react';
import { exercises } from './exercises';
import { parseHash } from './router';

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function getHash() {
  return window.location.hash;
}

export function App() {
  // The hash is external state: useSyncExternalStore reads it and re-renders when it changes.
  const hash = useSyncExternalStore(subscribe, getHash);
  const current = exercises.find((e) => e.id === parseHash(hash).id) ?? null;
  const Exercise = current?.component;

  return (
    <div className="app">
      <nav aria-label="Exercises">
        <h1>
          <a href="#/">React internals katas</a>
        </h1>
        <ol>
          {exercises.map((exercise) => (
            <li key={exercise.id}>
              <a href={`#/${exercise.id}`} aria-current={current?.id === exercise.id ? 'page' : undefined}>
                {exercise.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <main>
        {/* The key remounts the exercise on navigation, so its counters start from zero. */}
        {Exercise ? (
          <Exercise key={current.id} />
        ) : (
          <section className="home">
            <p>
              Scoped experiments on how React decides what to render again. Each exercise shows the flawed version next
              to the fixed one, with counters for renders and recomputations.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
