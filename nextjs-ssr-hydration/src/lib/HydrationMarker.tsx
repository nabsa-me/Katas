'use client';

import { useEffect } from 'react';

/**
 * Marks the document once React has hydrated it, so browser tests can wait for hydration
 * (and for any hydration error it reports) before asserting. Effects only run on the client.
 */
export function HydrationMarker() {
  useEffect(() => {
    document.body.dataset.hydrated = 'true';
  }, []);
  return null;
}
