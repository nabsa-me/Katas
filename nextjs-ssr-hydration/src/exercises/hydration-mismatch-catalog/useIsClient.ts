import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * `false` on the server and during hydration, `true` right after. React uses the server snapshot
 * while hydrating, so the first client render matches the HTML, then re-renders with the client one.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
