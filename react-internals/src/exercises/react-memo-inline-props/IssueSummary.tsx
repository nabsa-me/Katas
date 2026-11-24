import { Badge } from '../../lib/Comparison';
import { STATUS_LABELS, type Issue, type IssueStatus } from '../../lib/issues';
import { useRenderCount } from '../../lib/useRenderCount';
import { countByStatus } from './table';

interface IssueSummaryProps {
  items: readonly Issue[];
  /** Name under which the render counter is recorded. */
  counterName: string;
}

/** Stands for an expensive subtree (a chart, a big list) that should not render without a reason. */
export function IssueSummary({ items, counterName }: IssueSummaryProps) {
  const renders = useRenderCount(counterName);
  const counts = countByStatus(items);

  return (
    <div>
      <ul className="list">
        {(Object.keys(counts) as IssueStatus[]).map((status) => (
          <li key={status}>
            <span>{STATUS_LABELS[status]}</span>
            <strong>{counts[status]}</strong>
          </li>
        ))}
      </ul>
      <Badge label="renders" ref={renders} />
    </div>
  );
}
