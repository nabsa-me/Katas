import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { HydrationMarker } from '../../lib/HydrationMarker';
import { THEME_SCRIPT } from '../../exercises/theme-without-flash/theme-script';
import '../../lib/kata.css';

export const metadata: Metadata = { title: 'Theme from an inline script · Next.js SSR katas' };

/**
 * The server renders the same <html> for everybody (the route can stay static). The inline script in
 * <head> sets the theme class before the first paint. That class is not in the server HTML or in what
 * React renders, so React would report the difference: `suppressHydrationWarning` on <html>, and only
 * there, tells it the difference is expected. It only affects this element's own attributes.
 */
export default function SystemThemeLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        {children}
        <HydrationMarker />
      </body>
    </html>
  );
}
