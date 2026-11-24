import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Issue } from '../../lib/issues';
import type { FetchIssue } from './fake-issue-api';
import { IssueDetails as FixedDetails } from './IssueDetails';
import { IssueDetails as FlawedDetails } from './IssueDetails.problem';
import { SNIPPET_ISSUES } from './snippets';

const [first, second] = SNIPPET_ISSUES as [Issue, Issue];

/**
 * A fetcher whose responses the test releases by hand, in any order. Like the worst real server, it
 * ignores the abort signal: an aborted request still resolves.
 */
function controllableApi() {
  const pending = new Map<string, { resolve: (issue: Issue) => void; signal: AbortSignal }>();
  const fetchIssue: FetchIssue = (id, signal) => new Promise((resolve) => pending.set(id, { resolve, signal }));
  return {
    fetchIssue,
    signalFor: (id: string) => pending.get(id)!.signal,
    async respond(issue: Issue) {
      await act(async () => pending.get(issue.id)!.resolve(issue));
    },
  };
}

describe('race between two fetches', () => {
  it('shows the older issue when its response arrives last', async () => {
    const api = controllableApi();
    const { rerender } = render(<FlawedDetails issueId={first.id} fetchIssue={api.fetchIssue} />);
    rerender(<FlawedDetails issueId={second.id} fetchIssue={api.fetchIssue} />);

    await api.respond(second);
    await api.respond(first);

    expect(screen.getByText(first.key)).toBeInTheDocument();
    expect(screen.queryByText(second.key)).not.toBeInTheDocument();
  });

  it('with abort and a guard, keeps the issue that was asked for last', async () => {
    const api = controllableApi();
    const { rerender } = render(<FixedDetails issueId={first.id} fetchIssue={api.fetchIssue} />);
    rerender(<FixedDetails issueId={second.id} fetchIssue={api.fetchIssue} />);
    expect(api.signalFor(first.id).aborted).toBe(true);

    await api.respond(second);
    await api.respond(first);

    expect(screen.getByText(second.key)).toBeInTheDocument();
    expect(screen.queryByText(first.key)).not.toBeInTheDocument();
  });

  it('shows "Loading…" while the selected issue has not arrived, never the previous one', async () => {
    const api = controllableApi();
    const { rerender } = render(<FixedDetails issueId={first.id} fetchIssue={api.fetchIssue} />);
    await api.respond(first);
    rerender(<FixedDetails issueId={second.id} fetchIssue={api.fetchIssue} />);

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText(first.key)).not.toBeInTheDocument();
  });
});
