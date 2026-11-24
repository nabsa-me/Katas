import { memo, useCallback, useState, type CSSProperties } from 'react';
import { Badge } from '../../lib/Comparison';
import type { Issue } from '../../lib/issues';
import { useRenderCount } from '../../lib/useRenderCount';
import { TABLE_ISSUES, type Column } from './table';

// Values that never change live outside the component: created once, same reference forever.
const ROW_STYLE: CSSProperties = { fontVariantNumeric: 'tabular-nums' };
const COLUMNS: Column[] = ['key', 'title', 'assignee'];

interface RowProps {
  issue: Issue;
  selected: boolean;
  style: CSSProperties;
  columns: Column[];
  /** Receives the id, so one handler serves every row instead of one closure per row. */
  onSelect: (id: string) => void;
}

const Row = memo(function Row({ issue, selected, style, columns, onSelect }: RowProps) {
  const renders = useRenderCount(`Fixed row ${issue.key}`);
  return (
    <tr style={style} className={selected ? 'selected' : undefined}>
      {columns.map((column) => (
        <td key={column}>{issue[column]}</td>
      ))}
      <td>
        {/* A new arrow here is fine: a DOM element is not memoized, nothing compares it. */}
        <button
          type="button"
          aria-pressed={selected}
          aria-label={`Select ${issue.key}`}
          onClick={() => onSelect(issue.id)}
        >
          Select
        </button>
      </td>
      <td>
        <Badge label="renders" ref={renders} />
      </td>
    </tr>
  );
});

export function IssueTable() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Same function on every render: no dependencies, and the setter React returns is itself stable.
  const toggle = useCallback((id: string) => setSelectedId((current) => (current === id ? null : id)), []);

  return (
    <table className="table">
      <tbody>
        {TABLE_ISSUES.map((issue) => (
          <Row
            key={issue.id}
            issue={issue}
            selected={issue.id === selectedId}
            style={ROW_STYLE}
            columns={COLUMNS}
            onSelect={toggle}
          />
        ))}
      </tbody>
    </table>
  );
}
