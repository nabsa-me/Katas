'use client';

import { useEffect, useState } from 'react';
import { InitiativeFilter } from './InitiativeFilter';
import { parseInitiatives, type Initiative } from './initiative';

/**
 * BUG: the whole page is a Client Component that fetches in an effect. The server can only render the
 * loading state; the browser must download the JavaScript, hydrate, run the effect and only then
 * request the data: a waterfall, a spinner, and HTML without content.
 */
export function InitiativesPage() {
  const [initiatives, setInitiatives] = useState<Initiative[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/initiatives', { signal: controller.signal })
      .then((response) => response.json())
      .then((json: unknown) => setInitiatives(parseInitiatives(json)))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  return initiatives ? <InitiativeFilter initiatives={initiatives} /> : <p>Loading initiatives…</p>;
}
