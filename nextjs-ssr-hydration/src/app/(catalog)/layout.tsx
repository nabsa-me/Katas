import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { HydrationMarker } from '../../lib/HydrationMarker';
import '../../lib/kata.css';

export const metadata: Metadata = { title: 'Hydration mismatch catalog · Next.js SSR katas' };

export default function CatalogLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <HydrationMarker />
      </body>
    </html>
  );
}
