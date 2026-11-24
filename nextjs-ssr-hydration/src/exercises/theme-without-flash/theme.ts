export type Theme = 'light' | 'dark';

/** What the user chose: a theme, or "follow the operating system". */
export type ThemePreference = Theme | 'system';

/** Cookie read by the server and by the inline script. Not httpOnly on purpose: the script reads it. */
export const THEME_COOKIE = 'theme';

/** Key used by the flawed versions, which keep the choice in `localStorage`. */
export const THEME_STORAGE_KEY = 'theme';

export const DARK_QUERY = '(prefers-color-scheme: dark)';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Values from cookies, storage or forms come from outside: anything but a known theme is ignored. */
export function parseTheme(value: unknown): Theme | null {
  return value === 'light' || value === 'dark' ? value : null;
}

/** Reads the theme cookie from a `Cookie` header or from `document.cookie`. */
export function readThemeCookie(cookieHeader: string): Theme | null {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${THEME_COOKIE}=([^;]*)`));
  return parseTheme(match?.[1]);
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): Theme {
  if (preference !== 'system') return preference;
  return prefersDark ? 'dark' : 'light';
}

/** `document.cookie` assignment that stores a theme, or removes it when the user goes back to "system". */
export function themeCookieAssignment(theme: Theme | null, secure: boolean): string {
  const attributes = ['Path=/', 'SameSite=Lax', `Max-Age=${theme ? ONE_YEAR_SECONDS : 0}`];
  if (secure) attributes.push('Secure');
  return [`${THEME_COOKIE}=${theme ?? ''}`, ...attributes].join('; ');
}

/** Options for setting the cookie on the server (Server Action), equivalent to the assignment above. */
export function themeCookieOptions(secure: boolean) {
  return { path: '/', sameSite: 'lax' as const, maxAge: ONE_YEAR_SECONDS, httpOnly: false, secure };
}

/** The part of the DOM the theme touches, so the logic can be tested without a browser. */
export interface ThemeTarget {
  classList: { toggle(token: string, force?: boolean): boolean };
  style: { colorScheme: string };
}

/** Puts the theme on the root element: a class for the CSS variables, `color-scheme` for native controls. */
export function applyTheme(root: ThemeTarget, theme: Theme): void {
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
}
