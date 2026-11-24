import { Comparison } from '../../lib/Comparison';
import { HighlightedSummary as FlawedSummary } from './HighlightFrame.problem';
import { HighlightedSummary as FixedSummary } from './HighlightFrame';
import { IssueTable as FlawedTable } from './IssueTable.problem';
import { IssueTable as FixedTable } from './IssueTable';

export function ReactMemoInlineProps() {
  return (
    <Comparison
      title="React.memo defeated by inline props"
      instructions={
        <>
          Select a row in both tables: in the problem every row renders again, in the solution only the rows whose{' '}
          <code>selected</code> prop changed. Below, <strong>Highlight</strong> re-renders the summary only in the
          problem.
        </>
      }
      problem={
        <>
          <FlawedTable />
          <FlawedSummary />
        </>
      }
      solution={
        <>
          <FixedTable />
          <FixedSummary />
        </>
      }
    />
  );
}
