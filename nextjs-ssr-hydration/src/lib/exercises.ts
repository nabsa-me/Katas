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
];

/** Every route, for checks that apply to all of them. */
export function allRoutes(list: readonly Exercise[] = exercises): ExerciseRoute[] {
  return list.flatMap((exercise) => exercise.routes);
}
