export interface CodeownersRule {
  pattern: string;
  /** Empty when the pattern deliberately leaves its files without owners. */
  owners: string[];
}

/** One rule per non-empty, non-comment line: a pattern followed by its owners. */
export function parseCodeowners(text: string): CodeownersRule[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const [pattern = '', ...owners] = line.split(/\s+/);
      return { pattern, owners };
    });
}

const escape = (text: string) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

/**
 * The subset of CODEOWNERS patterns this kata uses, with GitHub's rules: a leading or middle `/`
 * anchors the pattern at the repository root (otherwise it matches at any depth), a trailing `/`
 * matches everything inside that folder, `*` stays within one folder and `**` crosses folders.
 * As GitHub documents, `docs/*` matches `docs/a.md` but not `docs/guides/a.md`.
 */
export function matchesPattern(pattern: string, path: string): boolean {
  const anchored = pattern.startsWith('/') || pattern.slice(0, -1).includes('/');
  const directory = pattern.endsWith('/');
  const body = pattern
    .replace(/^\//, '')
    .replace(/\/$/, '')
    .split('**')
    .map((part) => part.split('*').map(escape).join('[^/]*'))
    .join('.*');
  const end = directory ? '/' : /[^*]\*$/.test(pattern) ? '$' : '(?:$|/)';
  return new RegExp(`^${anchored ? '' : '(?:.*/)?'}${body}${end}`).test(path);
}

/**
 * The owners GitHub asks to review a change to `path`: those of the last matching rule, not the
 * union of every match. A file whose last match has no owners has none.
 */
export function ownersFor(path: string, rules: readonly CodeownersRule[]): string[] {
  return rules.findLast((rule) => matchesPattern(rule.pattern, path))?.owners ?? [];
}
