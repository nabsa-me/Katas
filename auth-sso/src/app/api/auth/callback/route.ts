import { NextResponse, type NextRequest } from 'next/server';
import { getConfig } from '../../../../exercises/oidc-nextjs/config';
import { completeLogin } from '../../../../exercises/oidc-nextjs/oidc-flow';
import {
  cookieOptions,
  openTransaction,
  sealSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  TRANSACTION_COOKIE,
} from '../../../../exercises/oidc-nextjs/session';

/** The provider redirects here with `code` and `state`; the tokens are obtained and checked on the server. */
export async function GET(request: NextRequest) {
  const { appUrl, sessionSecret } = getConfig();
  const transaction = await openTransaction(request.cookies.get(TRANSACTION_COOKIE)?.value, sessionSecret);
  if (!transaction) {
    return new NextResponse('The login expired or was started in another browser. Log in again.', { status: 400 });
  }

  try {
    const user = await completeLogin(request.nextUrl.search, transaction);
    const response = NextResponse.redirect(new URL(transaction.returnTo, appUrl), 303);
    response.cookies.set(
      SESSION_COOKIE,
      await sealSession(user, sessionSecret),
      cookieOptions(SESSION_MAX_AGE_SECONDS),
    );
    response.cookies.set(TRANSACTION_COOKIE, '', cookieOptions(0));
    return response;
  } catch (error) {
    // Wrong state, replayed code, invalid ID token...: log the cause, tell the user nothing exploitable.
    console.error('OIDC callback failed', error);
    return new NextResponse('The login could not be completed. Log in again.', { status: 400 });
  }
}
