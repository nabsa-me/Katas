import { caseHref, CASES, VARIANTS } from '../exercises/hydration-mismatch-catalog/cases';

export interface ExerciseRoute {
  label: string;
  href: string;
  kind: 'problem' | 'solution';
}

export interface Exercise {
  title: string;
  /** Folder under `src/exercises/` that holds the README and the code. */
  folder: string;
  routes: ExerciseRoute[];
}

/** What the home page lists. Each exercise has its own routes, one per variant. */
export const exercises: Exercise[] = [
  {
    title: 'Light/dark theme without flash or hydration mismatch',
    folder: 'theme-without-flash',
    routes: [
      {
        label: 'Theme read from localStorage during render',
        href: '/theme-without-flash/stored-in-render',
        kind: 'problem',
      },
      {
        label: 'Theme read from localStorage in an effect',
        href: '/theme-without-flash/stored-in-effect',
        kind: 'problem',
      },
      { label: 'Theme from a cookie, rendered on the server', href: '/theme-without-flash/cookie', kind: 'solution' },
      {
        label: 'Theme from an inline script, with the system preference',
        href: '/theme-without-flash/system',
        kind: 'solution',
      },
    ],
  },
  {
    title: 'Hydration mismatch catalog',
    folder: 'hydration-mismatch-catalog',
    routes: CASES.flatMap((entry) =>
      VARIANTS.map((variant) => ({
        label: `${entry.title} (${variant})`,
        href: caseHref(entry.slug, variant),
        kind: variant,
      })),
    ),
  },
  {
    title: 'Server Components vs. Client Components',
    folder: 'server-vs-client-components',
    routes: [
      {
        label: 'Data fetched in a client effect',
        href: '/server-vs-client-components/client-fetch-problem',
        kind: 'problem',
      },
      {
        label: 'A function passed to a Client Component',
        href: '/server-vs-client-components/function-prop-problem',
        kind: 'problem',
      },
      {
        label: 'A class instance passed to a Client Component',
        href: '/server-vs-client-components/class-instance-problem',
        kind: 'problem',
      },
      {
        label: 'Data fetched in a Server Component, with a client island',
        href: '/server-vs-client-components',
        kind: 'solution',
      },
    ],
  },
];

/** Every route, for checks that apply to all of them. */
export function allRoutes(list: readonly Exercise[] = exercises): ExerciseRoute[] {
  return list.flatMap((exercise) => exercise.routes);
}
