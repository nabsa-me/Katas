import { useEffect, useRef } from 'react';
import { renderLog } from './render-log';

/**
 * Counts how many times `value` changed identity (`Object.is`) between renders.
 * Passed the result of a `useMemo`, it counts how many times the memoized computation ran: `useMemo`
 * returns the cached reference until a dependency changes, and a new one each time it recomputes.
 */
export function useChangeCount<T extends HTMLElement>(name: string, value: unknown) {
  const badge = useRef<T>(null);
  useEffect(() => {
    const count = renderLog.record(name);
    if (badge.current) badge.current.textContent = String(count);
  }, [name, value]);
  return badge;
}
