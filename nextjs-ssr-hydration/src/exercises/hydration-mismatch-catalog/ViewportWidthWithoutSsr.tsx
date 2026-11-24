'use client';

import dynamic from 'next/dynamic';

/**
 * The component is left out of the server render: the HTML only has the loading fallback, and the
 * browser downloads and renders the real component after hydration. `ssr: false` is only allowed in
 * Client Components.
 */
export const ViewportWidthWithoutSsr = dynamic(() => import('./ViewportWidthLive'), {
  ssr: false,
  loading: () => <p>Loading the viewport width…</p>,
});
