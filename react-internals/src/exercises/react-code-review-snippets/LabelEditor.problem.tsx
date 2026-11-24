import { useState } from 'react';

export function LabelEditor() {
  const [labels, setLabels] = useState<string[]>(['backend']);
  const [draft, setDraft] = useState('');

  function add() {
    // BUG: mutates the array that is in state and passes the same reference back. React compares it
    // with `Object.is`, sees no change and skips the render: the label only appears when something
    // else renders the component. No lint rule reports this line, so it has to be caught in review.
    labels.push(draft.trim().toLowerCase());
    setLabels(labels);
  }

  return (
    <form
      className="controls"
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <label>
        New label
        <input value={draft} onChange={(e) => setDraft(e.target.value)} />
      </label>
      <button type="submit">Add</button>
      <ul className="list" aria-label="Labels">
        {labels.map((label) => (
          <li key={label}>{label}</li>
        ))}
      </ul>
    </form>
  );
}
