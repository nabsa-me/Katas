'use client';

import { formatTimestamp, LAST_SYNC } from './format';

export function LastSync() {
  // Explicit locale and time zone: the same text on the server and in every browser.
  return (
    <p>
      Last synchronised: <time dateTime={LAST_SYNC}>{formatTimestamp(LAST_SYNC)}</time>
    </p>
  );
}
