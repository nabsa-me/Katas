import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { HydrationMarker } from '../../lib/HydrationMarker';
import '../../lib/kata.css';

export const metadata: Metadata = { title: 'Server and Client Components · Next.js SSR katas' };

export default function ComponentsLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main className="page">{children}</main>
        <HydrationMarker />
      </body>
    </html>
  );
}
