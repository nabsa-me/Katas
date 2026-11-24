export type Variant = 'problem' | 'solution';

export const VARIANTS: readonly Variant[] = ['problem', 'solution'];

export interface MismatchCase {
  slug: string;
  title: string;
  /** One sentence: what differs between the server render and the first client render. */
  cause: string;
}

/** The catalog. Each case has a route per variant: `/hydration-mismatch-catalog/<slug>/<variant>`. */
export const CASES: readonly MismatchCase[] = [
  {
    slug: 'date-during-render',
    title: 'Formatting a date during render',
    cause: 'The server formats with its own time zone and locale; the browser with the user’s.',
  },
  {
    slug: 'random-ids',
    title: 'Random ids',
    cause: 'Math.random() returns a different value on the server and in the browser.',
  },
  {
    slug: 'typeof-window-branch',
    title: 'Branching on typeof window',
    cause: 'The server takes one branch and the first client render takes the other.',
  },
  {
    slug: 'browser-api-during-render',
    title: 'Browser-only APIs during render',
    cause: 'The server has no window; the browser reads a real value on its first render.',
  },
  {
    slug: 'invalid-html-nesting',
    title: 'Invalid HTML nesting',
    cause: 'The browser’s parser closes the <p> before the <div>, so the DOM is not the tree React rendered.',
  },
];

export function findCase(slug: string): MismatchCase | undefined {
  return CASES.find((entry) => entry.slug === slug);
}

export function isVariant(value: string): value is Variant {
  return (VARIANTS as readonly string[]).includes(value);
}

export function caseHref(slug: string, variant: Variant): string {
  return `/hydration-mismatch-catalog/${slug}/${variant}`;
}
