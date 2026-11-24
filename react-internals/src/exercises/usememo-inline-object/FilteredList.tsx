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

/**
 * Fix in the child: depend on the primitive values inside `filters`. Strings compare by value, so the
 * memo survives a parent that recreates the object on every render.
 */
export function FilteredList({ items, filters }: FilteredListProps) {
  const { status, query } = filters;
  const visible = useMemo(() => expensiveFilter(items, { status, query }), [items, status, query]);
  const computations = useChangeCount('Fixed filter computations', visible);

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

  // Fix in the parent: the object keeps its reference until `status` or `query` change.
  // Either fix is enough on its own; this one also protects any other consumer of `filters`.
  const filters = useMemo(() => ({ status, query }), [status, query]);

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
