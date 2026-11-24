import { cookies } from 'next/headers';
import { getConfig } from './config';
import { openSession, SESSION_COOKIE, type SessionUser } from './session';

/** The signed-in user for Server Components and Route Handlers, verified from the session cookie. */
export async function currentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  return openSession(store.get(SESSION_COOKIE)?.value, getConfig().sessionSecret);
}
