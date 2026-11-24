import { useState } from 'react';
import type { Issue } from '../../lib/issues';
import { SNIPPET_ISSUES } from './snippets';

/** Keeps an editable draft, initialised from the issue. It is reset by giving it a new `key`. */
function TitleEditor({ issue }: { issue: Issue }) {
  const [title, setTitle] = useState(issue.title);
  return (
    <label>
      Title <input value={title} onChange={(e) => setTitle(e.target.value)} />
    </label>
  );
}

export function IssueEditor() {
  const [selectedId, setSelectedId] = useState(SNIPPET_ISSUES[0]!.id);
  // Derived during render: no state copied from other state, nothing to keep in sync.
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
      {/* A different key is a different component for React: the draft starts again from the new issue. */}
      <TitleEditor key={issue.id} issue={issue} />
    </>
  );
}
