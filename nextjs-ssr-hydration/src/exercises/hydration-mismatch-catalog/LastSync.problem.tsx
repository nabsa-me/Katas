'use client';

import { LAST_SYNC } from './format';

export function LastSync() {
  // BUG: toLocaleString uses the time zone and locale of wherever it runs. The server (UTC, its own
  // locale) and the user's browser produce different text, and the hydration fails.
  return <p>Last synchronised: {new Date(LAST_SYNC).toLocaleString()}</p>;
}
