import { useEffect, useState } from 'react';
import type { Issue } from '../../lib/issues';
import type { FetchIssue } from './fake-issue-api';

interface IssueDetailsProps {
  issueId: string;
  fetchIssue: FetchIssue;
}

export function IssueDetails({ issueId, fetchIssue }: IssueDetailsProps) {
  const [issue, setIssue] = useState<Issue | null>(null);

  useEffect(() => {
    // BUG: nothing cancels or ignores the previous request. If the response for an old id arrives
    // after the response for the current one, it overwrites it and the panel shows the wrong issue.
    fetchIssue(issueId, new AbortController().signal).then(setIssue);
  }, [issueId, fetchIssue]);

  return (
    <p aria-live="polite">
      {issue ? (
        <>
          <strong>{issue.key}</strong> {issue.title}
        </>
      ) : (
        'Loading…'
      )}
    </p>
  );
}
