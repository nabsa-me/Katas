import { useState } from 'react';
import { moveUp, SNIPPET_ISSUES } from './snippets';

export function ReorderableList() {
  const [items, setItems] = useState(SNIPPET_ISSUES);

  return (
    <ol className="list">
      {items.map((issue, index) => (
        // BUG: the key is the position. After a move, React keeps each <li> where it was, with its
        // input and whatever was typed in it, and only updates the text: the note stays behind.
        <li key={index}>
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
