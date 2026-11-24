import { useEffect, useState } from 'react';
import { Badge } from '../../lib/Comparison';
import { issues, type Issue } from '../../lib/issues';
import { useRenderCount } from '../../lib/useRenderCount';
import { ASSIGNEES, issuesFor } from './snippets';

export function AssigneeIssues() {
  const [assignee, setAssignee] = useState(ASSIGNEES[0]!);
  const [visible, setVisible] = useState<Issue[]>([]);
  const renders = useRenderCount('Flawed assignee list');

  // BUG: derived data computed in an effect and stored in state. Every change paints the old list
  // first, then the effect sets the new one and causes a second render.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the flawed version: derived data copied into state
    setVisible(issuesFor(issues, assignee));
  }, [assignee]);

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
