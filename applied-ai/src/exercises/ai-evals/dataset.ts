import { readFileSync } from 'node:fs';
import { z } from 'zod';

/** The labels the feature assigns: one work type per Jira issue. */
export const WORK_TYPES = ['bug', 'feature', 'chore', 'incident', 'security'] as const;
export type WorkType = (typeof WORK_TYPES)[number];

const goldenLineSchema = z.strictObject({
  summary: z.string().min(1),
  description: z.string(),
  expected: z.enum(WORK_TYPES),
  /** A regular expression for cases where more than one label is right; otherwise the label must match exactly. */
  accept: z
    .string()
    .refine((source) => isValidRegex(source), 'expected a valid regular expression')
    .optional(),
  /** Why the case is hard. Edge cases are reported separately: they are where regressions show first. */
  edgeCase: z.string().min(1).optional(),
});

export interface GoldenCase extends z.infer<typeof goldenLineSchema> {
  /** Generated from the summary, so a case keeps its id when lines are reordered. */
  id: string;
}

function isValidRegex(source: string): boolean {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}

/** Turns a title into an id: `Dark mode` → `dark-mode`. */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Parses a golden dataset in JSON Lines: one case per line, blank lines ignored. Every problem is reported with its
 * line number, and duplicate ids are rejected: a golden set is data that the CI gate trusts, so it is validated like
 * any external input.
 */
export function parseGoldenJsonl(text: string): GoldenCase[] {
  const cases: GoldenCase[] = [];
  const problems: string[] = [];
  const seen = new Map<string, number>();
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === '') return;
    const lineNumber = index + 1;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      problems.push(`line ${lineNumber}: not valid JSON`);
      return;
    }
    const parsed = goldenLineSchema.safeParse(json);
    if (!parsed.success) {
      problems.push(`line ${lineNumber}: ${z.prettifyError(parsed.error).replace(/\n/g, '; ')}`);
      return;
    }
    const id = slugify(parsed.data.summary);
    const previous = seen.get(id);
    if (previous !== undefined) problems.push(`line ${lineNumber}: duplicate id "${id}" (first on line ${previous})`);
    seen.set(id, lineNumber);
    cases.push({ id, ...parsed.data });
  });
  if (problems.length > 0) throw new Error(`Invalid golden dataset:\n${problems.join('\n')}`);
  return cases;
}

export const GOLDEN_FILE = new URL('./golden.jsonl', import.meta.url);

export function loadGoldenCases(file: URL = GOLDEN_FILE): GoldenCase[] {
  return parseGoldenJsonl(readFileSync(file, 'utf8'));
}
