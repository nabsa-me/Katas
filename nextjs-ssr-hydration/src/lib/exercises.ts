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
export const exercises: Exercise[] = [];

/** Every route, for checks that apply to all of them. */
export function allRoutes(list: readonly Exercise[] = exercises): ExerciseRoute[] {
  return list.flatMap((exercise) => exercise.routes);
}
