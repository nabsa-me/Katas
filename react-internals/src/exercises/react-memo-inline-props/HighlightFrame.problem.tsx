import { useState } from 'react';
import { issues } from '../../lib/issues';
import { IssueSummary } from './IssueSummary';

/**
 * Owns the highlight state and renders the summary itself. Every toggle renders this component, and
 * with it every element it creates, so the summary renders again although nothing it shows changed.
 */
export function HighlightedSummary() {
  const [highlighted, setHighlighted] = useState(false);

  return (
    <div className={highlighted ? 'frame highlighted' : 'frame'}>
      <button type="button" aria-pressed={highlighted} onClick={() => setHighlighted((h) => !h)}>
        Highlight
      </button>
      <IssueSummary items={issues} counterName="Flawed summary" />
    </div>
  );
}
