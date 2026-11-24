import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { HydrationMarker } from '../../lib/HydrationMarker';
import { parseTheme, THEME_COOKIE } from '../../exercises/theme-without-flash/theme';
import '../../lib/kata.css';

export const metadata: Metadata = { title: 'Theme from a cookie · Next.js SSR katas' };

/**
 * The server reads the cookie sent with the request and renders <html> with the right class, so the
 * HTML the browser paints first is already themed and the client renders exactly the same markup.
 * Reading a request cookie makes every route under this layout dynamic (rendered per request).
 */
export default async function CookieThemeLayout({ children }: { children: ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value) ?? 'light';
  return (
    <html lang="en" className={theme}>
      <body>
        {children}
        <HydrationMarker />
      </body>
    </html>
  );
}
