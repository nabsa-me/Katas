import { useState, type ReactNode } from 'react';
import { issues } from '../../lib/issues';
import { IssueSummary } from './IssueSummary';

/**
 * Owns the highlight state but receives its content as `children`. When the state changes, React
 * renders this frame again, but `children` is the same element object the parent created before:
 * same props, so React skips that subtree without any `memo`.
 */
export function HighlightFrame({ children }: { children: ReactNode }) {
  const [highlighted, setHighlighted] = useState(false);

  return (
    <div className={highlighted ? 'frame highlighted' : 'frame'}>
      <button type="button" aria-pressed={highlighted} onClick={() => setHighlighted((h) => !h)}>
        Highlight
      </button>
      {children}
    </div>
  );
}

export function HighlightedSummary() {
  return (
    <HighlightFrame>
      <IssueSummary items={issues} counterName="Fixed summary" />
    </HighlightFrame>
  );
}
