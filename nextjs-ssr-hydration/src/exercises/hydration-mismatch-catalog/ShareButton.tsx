'use client';

import { useIsClient } from './useIsClient';

export function ShareButton() {
  // Same output as the server during hydration, the browser-only button right after.
  const isClient = useIsClient();
  return isClient ? (
    <button type="button" onClick={() => navigator.clipboard.writeText(location.href)}>
      Copy link
    </button>
  ) : (
    <p>Sharing is not available yet.</p>
  );
}
