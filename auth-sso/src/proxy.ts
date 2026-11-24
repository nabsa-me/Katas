import { NextResponse, type NextRequest } from 'next/server';
import { getConfig } from './exercises/oidc-nextjs/config';
import { decideAccess } from './exercises/oidc-nextjs/guard';
import { openSession, SESSION_COOKIE } from './exercises/oidc-nextjs/session';

/**
 * Next.js 16 renamed `middleware.ts` to `proxy.ts` (function `proxy`, Node.js runtime). It runs before the
 * route renders, so an unauthorized request never reaches the page or the handler. It is the first check,
 * not the only one: the admin page and the admin API check the role again.
 */
export async function proxy(request: NextRequest) {
  const user = await openSession(request.cookies.get(SESSION_COOKIE)?.value, getConfig().sessionSecret);
  const decision = decideAccess(request.nextUrl, user, 'admin');

  if (decision.type === 'allow') return NextResponse.next();
  if (decision.type === 'login') return NextResponse.redirect(new URL(decision.location, request.url));
  if (decision.body === 'json') {
    const error = decision.status === 401 ? 'unauthenticated' : 'forbidden';
    return Response.json({ error }, { status: decision.status });
  }
  // Renders the /forbidden page at the same URL, with the status set here.
  return NextResponse.rewrite(new URL('/forbidden', request.url), { status: decision.status });
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};
