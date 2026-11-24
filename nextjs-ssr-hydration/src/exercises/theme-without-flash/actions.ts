'use server';

import { cookies } from 'next/headers';
import { parseTheme, THEME_COOKIE, themeCookieOptions } from './theme';

/**
 * Server Action behind the theme form. Cookies can only be set here or in a Route Handler: by the time
 * a Server Component renders, the response headers are already being streamed. Next.js returns the
 * re-rendered route (root layout included) in the same round trip, so `<html>` gets the new class.
 */
export async function setThemeAction(formData: FormData): Promise<void> {
  const theme = parseTheme(formData.get('theme'));
  if (!theme) return; // a form post is external input
  (await cookies()).set(THEME_COOKIE, theme, themeCookieOptions(process.env.NODE_ENV === 'production'));
}
