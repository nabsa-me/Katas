import { memo, useState, type CSSProperties } from 'react';
import { Badge } from '../../lib/Comparison';
import type { Issue } from '../../lib/issues';
import { useRenderCount } from '../../lib/useRenderCount';
import { TABLE_ISSUES, type Column } from './table';

interface RowProps {
  issue: Issue;
  selected: boolean;
  style: CSSProperties;
  columns: Column[];
  onSelect: () => void;
}

/** Memoized row: it should only render again when one of its own props changes. */
const Row = memo(function Row({ issue, selected, style, columns, onSelect }: RowProps) {
  const renders = useRenderCount(`Flawed row ${issue.key}`);
  return (
    <tr style={style} className={selected ? 'selected' : undefined}>
      {columns.map((column) => (
        <td key={column}>{issue[column]}</td>
      ))}
      <td>
        <button type="button" aria-pressed={selected} aria-label={`Select ${issue.key}`} onClick={onSelect}>
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

  return (
    <table className="table">
      <tbody>
        {TABLE_ISSUES.map((issue) => (
          <Row
            key={issue.id}
            issue={issue}
            selected={issue.id === selectedId}
            // BUG: three new references per row on every render. `memo` compares each prop with
            // `Object.is`, always finds a change and renders every row again.
            style={{ fontVariantNumeric: 'tabular-nums' }}
            columns={['key', 'title', 'assignee']}
            onSelect={() => setSelectedId((current) => (current === issue.id ? null : issue.id))}
          />
        ))}
      </tbody>
    </table>
  );
}
