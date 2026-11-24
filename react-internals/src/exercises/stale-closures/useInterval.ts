import { useEffect, useRef } from 'react';

/**
 * Calls `callback` every `delay` milliseconds; `null` pauses it.
 *
 * The interval is created again only when `delay` changes. Each tick calls the latest `callback`,
 * kept in a ref, so the callback can read fresh props and state without restarting the timer.
 */
export function useInterval(callback: () => void, delay: number | null): void {
  const latest = useRef(callback);

  // Point the ref at the callback of the last committed render. It is written in an effect because
  // writing a ref during render is not allowed: a render may be thrown away before it commits.
  useEffect(() => {
    latest.current = callback;
  });

  useEffect(() => {
    if (delay === null) return;
    const id = setInterval(() => latest.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}
