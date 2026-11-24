import { Comparison } from '../../lib/Comparison';
import { IssueBoard as FlawedBoard } from './FilteredList.problem';
import { IssueBoard as FixedBoard } from './FilteredList';

export function UseMemoInlineObject() {
  return (
    <Comparison
      title="useMemo with an inline object dependency"
      instructions={
        <>
          Press <strong>Unrelated update</strong> in both panels: the problem runs the filter again every time, the
          solution never does. Changing the status or the search runs it in both, as it should.
        </>
      }
      problem={<FlawedBoard />}
      solution={<FixedBoard />}
    />
  );
}
