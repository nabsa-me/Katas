import { useState } from 'react';
import { Badge } from '../../lib/Comparison';
import { issues } from '../../lib/issues';
import { useRenderCount } from '../../lib/useRenderCount';
import { ASSIGNEES, issuesFor } from './snippets';

export function AssigneeIssues() {
  const [assignee, setAssignee] = useState(ASSIGNEES[0]!);
  const renders = useRenderCount('Fixed assignee list');

  // Computed during render from state and props: always in sync, one render per change.
  // Wrap it in useMemo only if profiling shows the computation is expensive.
  const visible = issuesFor(issues, assignee);

  return (
    <>
      <label className="controls">
        Assignee
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          {ASSIGNEES.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>
      <p className="muted">
        {visible.length} issues · <Badge label="renders" ref={renders} />
      </p>
    </>
  );
}
