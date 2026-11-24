import { useState } from 'react';
import { moveUp, SNIPPET_ISSUES } from './snippets';

export function ReorderableList() {
  const [items, setItems] = useState(SNIPPET_ISSUES);

  return (
    <ol className="list">
      {items.map((issue, index) => (
        // The key is the identity of the item: React moves the <li>, and its input, with the issue.
        <li key={issue.id}>
          <label>
            Note for {issue.key} <input />
          </label>
          <button
            type="button"
            disabled={index === 0}
            aria-label={`Move ${issue.key} up`}
            onClick={() => setItems((current) => moveUp(current, index))}
          >
            Move up
          </button>
        </li>
      ))}
    </ol>
  );
}
