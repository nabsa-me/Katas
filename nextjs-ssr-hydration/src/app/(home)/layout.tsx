import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { HydrationMarker } from '../../lib/HydrationMarker';
import '../../lib/kata.css';

export const metadata: Metadata = { title: 'Katas · Next.js SSR and hydration' };

/**
 * One of several root layouts (one per route group). Some exercises need full control of `<html>`,
 * so there is no shared top-level layout; moving between root layouts is a full page load.
 */
export default function HomeLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <HydrationMarker />
      </body>
    </html>
  );
}
