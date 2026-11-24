import { useEffect, useRef } from 'react';
import { renderLog } from './render-log';

/**
 * Counts the renders of the calling component that React actually committed.
 *
 * An effect without a dependency array runs after every committed render, and does not run when React
 * skips the component (for example when `memo` bails out). Writing the number straight into the DOM
 * keeps the counter out of React state, so displaying it never causes another render.
 * Attach the returned ref to the element that shows the number.
 */
export function useRenderCount<T extends HTMLElement>(name: string) {
  const badge = useRef<T>(null);
  useEffect(() => {
    const count = renderLog.record(name);
    if (badge.current) badge.current.textContent = String(count);
  });
  return badge;
}
