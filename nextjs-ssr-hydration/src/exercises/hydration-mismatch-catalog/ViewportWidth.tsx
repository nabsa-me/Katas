'use client';

import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void) {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}

/**
 * The window as an external store. `getServerSnapshot` (null) is used on the server and during
 * hydration, so the first client render matches; then React renders the real width and keeps it
 * updated on resize. Server HTML is still produced, with a placeholder.
 */
export function ViewportWidth() {
  const width = useSyncExternalStore(
    subscribe,
    () => window.innerWidth,
    () => null,
  );
  return <p>Viewport width: {width === null ? 'unknown' : `${width}px`}</p>;
}
