import { useMemo, useState } from 'react';
import { Badge } from '../../lib/Comparison';
import { issues, type Issue } from '../../lib/issues';
import { useChangeCount } from '../../lib/useChangeCount';
import { expensiveFilter, type IssueFilters } from './filter';
import { FilterControls } from './FilterControls';

interface FilteredListProps {
  items: readonly Issue[];
  filters: IssueFilters;
}

/** Memoizes on `filters`, an object: it only works if the parent keeps that object's reference stable. */
export function FilteredList({ items, filters }: FilteredListProps) {
  const visible = useMemo(() => expensiveFilter(items, filters), [items, filters]);
  const computations = useChangeCount('Flawed filter computations', visible);

  return (
    <>
      <p className="muted">
        {visible.length} issues · <Badge label="computations" ref={computations} />
      </p>
      <ul className="list">
        {visible.map((issue) => (
          <li key={issue.id}>
            <span>{issue.title}</span>
            <span className="muted">{issue.key}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function IssueBoard() {
  const [status, setStatus] = useState<IssueFilters['status']>('all');
  const [query, setQuery] = useState('');
  const [unrelated, setUnrelated] = useState(0);

  // BUG: a new object on every render. `useMemo` in the child compares it with `Object.is`,
  // finds a different reference each time and runs the filter again, whatever state changed.
  const filters = { status, query };

  return (
    <>
      <FilterControls
        status={status}
        query={query}
        onStatusChange={setStatus}
        onQueryChange={setQuery}
        onUnrelatedUpdate={() => setUnrelated((n) => n + 1)}
        unrelatedCount={unrelated}
      />
      <FilteredList items={issues} filters={filters} />
    </>
  );
}
