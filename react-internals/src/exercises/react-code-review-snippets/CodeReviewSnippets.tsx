import { useState, type ComponentType } from 'react';
import { Comparison } from '../../lib/Comparison';
import { AssigneeIssues as FixedAssigneeIssues } from './AssigneeIssues';
import { AssigneeIssues as FlawedAssigneeIssues } from './AssigneeIssues.problem';
import { createFakeIssueApi, type FetchIssue } from './fake-issue-api';
import { IssueDetails as FixedIssueDetails } from './IssueDetails';
import { IssueDetails as FlawedIssueDetails } from './IssueDetails.problem';
import { IssueEditor as FixedIssueEditor } from './IssueEditor';
import { IssueEditor as FlawedIssueEditor } from './IssueEditor.problem';
import { LabelEditor as FixedLabelEditor } from './LabelEditor';
import { LabelEditor as FlawedLabelEditor } from './LabelEditor.problem';
import { ReorderableList as FixedReorderableList } from './ReorderableList';
import { ReorderableList as FlawedReorderableList } from './ReorderableList.problem';
import { SNIPPET_ISSUES } from './snippets';

// Created once: a new fetcher on every render would be a new effect dependency every time.
const fetchIssue = createFakeIssueApi();

interface DetailsProps {
  issueId: string;
  fetchIssue: FetchIssue;
}

/** Lets the user switch issues quickly; the first issue answers slowly, the others fast. */
function IssueDetailsDemo({ Details }: { Details: ComponentType<DetailsProps> }) {
  const [issueId, setIssueId] = useState(SNIPPET_ISSUES[0]!.id);
  return (
    <>
      <div className="controls">
        {SNIPPET_ISSUES.map((issue) => (
          <button key={issue.id} type="button" aria-pressed={issue.id === issueId} onClick={() => setIssueId(issue.id)}>
            {issue.key}
          </button>
        ))}
      </div>
      <Details issueId={issueId} fetchIssue={fetchIssue} />
    </>
  );
}

export function CodeReviewSnippets() {
  return (
    <>
      <Comparison
        title="Index as key in a reorderable list"
        instructions="Type a note in the second row, then move that row up: the note stays behind in the problem."
        problem={<FlawedReorderableList />}
        solution={<FixedReorderableList />}
      />
      <Comparison
        title="State copied from props"
        instructions="Select another issue: the problem keeps editing the first title."
        problem={<FlawedIssueEditor />}
        solution={<FixedIssueEditor />}
      />
      <Comparison
        title="Derived data computed in an effect"
        instructions="Change the assignee: the problem renders twice per change and paints the old count first."
        problem={<FlawedAssigneeIssues />}
        solution={<FixedAssigneeIssues />}
      />
      <Comparison
        title="Race condition when fetching in an effect"
        instructions={`Click ${SNIPPET_ISSUES[0]!.key} (slow) and then quickly another issue: the problem ends up showing ${SNIPPET_ISSUES[0]!.key}.`}
        problem={<IssueDetailsDemo Details={FlawedIssueDetails} />}
        solution={<IssueDetailsDemo Details={FixedIssueDetails} />}
      />
      <Comparison
        title="State mutated in place"
        instructions="Add a label: it does not appear in the problem until something else renders it (type another letter)."
        problem={<FlawedLabelEditor />}
        solution={<FixedLabelEditor />}
      />
    </>
  );
}
