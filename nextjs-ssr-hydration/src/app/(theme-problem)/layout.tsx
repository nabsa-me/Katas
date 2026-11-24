import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { HydrationMarker } from '../../lib/HydrationMarker';
import '../../lib/kata.css';

export const metadata: Metadata = { title: 'Theme kept in localStorage · Next.js SSR katas' };

/** Root layout of the flawed variants: the server knows nothing about the theme. */
export default function StoredThemeLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <HydrationMarker />
      </body>
    </html>
  );
}
