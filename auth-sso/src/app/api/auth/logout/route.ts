import { NextResponse } from 'next/server';
import { endSessionUrl } from '../../../../exercises/oidc-nextjs/oidc-flow';
import { cookieOptions, SESSION_COOKIE } from '../../../../exercises/oidc-nextjs/session';

/**
 * POST only: a GET logout can be triggered by any `<img src>` on another site. Clears the app session,
 * then sends the browser to the provider's end-session endpoint so its session ends too (otherwise the
 * next "Log in" signs the user straight back in). 303 turns the POST into a GET on the redirect.
 */
export async function POST() {
  const response = NextResponse.redirect(await endSessionUrl(), 303);
  response.cookies.set(SESSION_COOKIE, '', cookieOptions(0));
  return response;
}
