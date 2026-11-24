import { useEffect, useState } from 'react';
import type { Issue } from '../../lib/issues';
import type { FetchIssue } from './fake-issue-api';

interface IssueDetailsProps {
  issueId: string;
  fetchIssue: FetchIssue;
}

/** What the last finished request returned, tagged with the id it was for. */
type Result = { id: string; issue: Issue } | { id: string; error: string };

export function IssueDetails({ issueId, fetchIssue }: IssueDetailsProps) {
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchIssue(issueId, controller.signal)
      .then((issue) => {
        // Guard as well as abort: a fetcher that ignores the signal still resolves late.
        if (!controller.signal.aborted) setResult({ id: issueId, issue });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setResult({ id: issueId, error: String(error) });
      });
    // Runs before the effect runs again for a new id, and on unmount.
    return () => controller.abort();
  }, [issueId, fetchIssue]);

  // Derived, not stored: the result only counts if it belongs to the id on screen.
  const current = result?.id === issueId ? result : null;

  return (
    <p aria-live="polite">
      {!current && 'Loading…'}
      {current && 'issue' in current && (
        <>
          <strong>{current.issue.key}</strong> {current.issue.title}
        </>
      )}
      {current && 'error' in current && <span role="alert">{current.error}</span>}
    </p>
  );
}
