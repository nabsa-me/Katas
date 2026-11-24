export interface Exercise {
  title: string;
  /** One sentence on what the exercise shows. */
  summary: string;
  /** The demo route in this app, or the command that runs the exercise when it lives outside Next.js. */
  demo: { href: string } | { command: string };
}

export const exercises: Exercise[] = [];
