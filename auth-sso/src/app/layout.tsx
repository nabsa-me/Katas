import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Katas · Auth and SSO',
  description: 'OpenID Connect in Next.js and JWT validation in an API, solved and explained.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <a href="/">Auth and SSO katas</a>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
