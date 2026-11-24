import { STATUS_LABELS, type IssueStatus } from '../../lib/issues';
import type { IssueFilters } from './filter';

interface FilterControlsProps {
  status: IssueFilters['status'];
  query: string;
  onStatusChange: (status: IssueFilters['status']) => void;
  onQueryChange: (query: string) => void;
  /** Bumps a piece of parent state that has nothing to do with the filter. */
  onUnrelatedUpdate: () => void;
  unrelatedCount: number;
}

const STATUSES = Object.keys(STATUS_LABELS) as IssueStatus[];

export function FilterControls(props: FilterControlsProps) {
  return (
    <div className="controls">
      <label>
        Status
        <select value={props.status} onChange={(e) => props.onStatusChange(e.target.value as IssueFilters['status'])}>
          <option value="all">All</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Search
        <input type="search" value={props.query} onChange={(e) => props.onQueryChange(e.target.value)} />
      </label>
      <button type="button" onClick={props.onUnrelatedUpdate}>
        Unrelated update ({props.unrelatedCount})
      </button>
    </div>
  );
}
