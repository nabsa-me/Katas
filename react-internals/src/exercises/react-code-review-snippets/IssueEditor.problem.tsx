import { useState } from 'react';
import type { Issue } from '../../lib/issues';
import { SNIPPET_ISSUES } from './snippets';

function TitleEditor({ issue }: { issue: Issue }) {
  // BUG: the prop is copied into state once, when the component mounts. Selecting another issue
  // re-renders it with a new prop, but `useState` ignores its argument after the first render.
  const [title, setTitle] = useState(issue.title);
  return (
    <label>
      Title <input value={title} onChange={(e) => setTitle(e.target.value)} />
    </label>
  );
}

export function IssueEditor() {
  const [selectedId, setSelectedId] = useState(SNIPPET_ISSUES[0]!.id);
  const issue = SNIPPET_ISSUES.find((i) => i.id === selectedId) ?? SNIPPET_ISSUES[0]!;

  return (
    <>
      <div className="controls">
        {SNIPPET_ISSUES.map((i) => (
          <button key={i.id} type="button" aria-pressed={i.id === selectedId} onClick={() => setSelectedId(i.id)}>
            {i.key}
          </button>
        ))}
      </div>
      <h4>{issue.key}</h4>
      <TitleEditor issue={issue} />
    </>
  );
}
