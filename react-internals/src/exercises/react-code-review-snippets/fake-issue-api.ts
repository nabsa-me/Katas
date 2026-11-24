import type { Issue } from '../../lib/issues';
import { SNIPPET_ISSUES } from './snippets';

export type FetchIssue = (id: string, signal: AbortSignal) => Promise<Issue>;

/**
 * A fake API for the demo: the first issue answers slowly and the others fast, so clicking the first
 * issue and then another one reproduces responses arriving out of order. It honours `signal` like
 * `fetch` does, rejecting with an `AbortError`.
 */
export function createFakeIssueApi(slowMs = 1500, fastMs = 300): FetchIssue {
  return (id, signal) =>
    new Promise((resolve, reject) => {
      const issue = SNIPPET_ISSUES.find((i) => i.id === id);
      const timer = setTimeout(
        () => (issue ? resolve(issue) : reject(new Error(`Issue ${id} not found`))),
        id === SNIPPET_ISSUES[0]!.id ? slowMs : fastMs,
      );
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('The request was aborted', 'AbortError'));
      });
    });
}
