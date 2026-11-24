import { NextResponse, type NextRequest } from 'next/server';
import { getConfig } from '../../../../exercises/oidc-nextjs/config';
import { startLogin } from '../../../../exercises/oidc-nextjs/oidc-flow';
import { safeReturnTo } from '../../../../exercises/oidc-nextjs/return-to';
import {
  cookieOptions,
  sealTransaction,
  TRANSACTION_COOKIE,
  TRANSACTION_MAX_AGE_SECONDS,
} from '../../../../exercises/oidc-nextjs/session';

/** Starts a login: keeps the PKCE verifier, state and nonce in a signed cookie and redirects to the provider. */
export async function GET(request: NextRequest) {
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get('returnTo'));
  const { authorizationUrl, transaction } = await startLogin(returnTo);
  const response = NextResponse.redirect(authorizationUrl, 303);
  const sealed = await sealTransaction(transaction, getConfig().sessionSecret);
  response.cookies.set(TRANSACTION_COOKIE, sealed, cookieOptions(TRANSACTION_MAX_AGE_SECONDS));
  return response;
}
