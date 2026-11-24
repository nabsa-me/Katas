import { useState } from 'react';
import { addLabel } from './snippets';

export function LabelEditor() {
  const [labels, setLabels] = useState<readonly string[]>(['backend']);
  const [draft, setDraft] = useState('');

  // A new array every time something is added: React sees a new reference and renders.
  // Empty or duplicated labels return the same array, and React skips the render.
  const add = () => setLabels((current) => addLabel(current, draft));

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
